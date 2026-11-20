import type { CreateDocumentRequest, UpdateBodyRequest, WorkspaceView } from "./workspace_dto.ts";
import { WorkspaceCommandError, type WorkspacePort } from "./workspace_port.ts";

/**
 * State owner of the v3 body slice (`docs/design/ui-state-ownership.md`).
 *
 * - committed: the saved read model from the backend (source of truth: backend Loro).
 * - drafts: unsaved input per document. Kept on every failure; dropped only when the saved
 *   body equals the draft.
 * - one mutation at a time. A failed mutation is kept and resent unchanged by `retry`, so the
 *   backend recognises it by request ID instead of applying it twice.
 * - loads carry a generation; an older response never overwrites a newer one, and nothing is
 *   published after `dispose`.
 */
export type LoadState = "loading" | "ready" | "unavailable";
export type SaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict";
export type DocumentSummary = { id: string; title: string; dirty: boolean };

type Mutation =
	| { kind: "create"; request: CreateDocumentRequest }
	| { kind: "body"; request: UpdateBodyRequest };

const UNTITLED = "無題";
const CONFLICT_MESSAGE =
	"ほかの変更が保存されていたため、最新の内容を読み込みました。もう一度保存してください。";
const PENDING_MESSAGE = "未保存の変更があります。再試行してください。";
/** Kinds where resending the same request cannot succeed. */
const FINAL_KINDS = new Set([
	"invalid_request",
	"workspace_unavailable",
	"request_reused",
	"recovery_required",
	"unknown_block",
	"duplicate_block",
	"no_body",
	"nothing_to_retry",
]);

export class BodyEditorController {
	#committed = $state<WorkspaceView | null>(null);
	#loadState = $state<LoadState>("loading");
	#unavailableMessage = $state("");
	#selectedId = $state<string | null>(null);
	#drafts = $state<Record<string, string>>({});
	#status = $state<SaveStatus>("idle");
	#statusMessage = $state("");
	#busy = $state(false);
	#failed = $state<Mutation | null>(null);
	/** The backend holds an applied change of an unknown request (e.g. after a page reload). */
	#backendPending = $state(false);
	#saveQueued = false;
	#loadGeneration = 0;
	#disposed = false;
	readonly #port: WorkspacePort;
	readonly #newRequestId: () => string;

	constructor(port: WorkspacePort, newRequestId: () => string) {
		this.#port = port;
		this.#newRequestId = newRequestId;
	}

	get loadState(): LoadState {
		return this.#loadState;
	}

	get unavailableMessage(): string {
		return this.#unavailableMessage;
	}

	get documents(): DocumentSummary[] {
		return (this.#committed?.blocks ?? [])
			.filter((block) => block.parentId === null)
			.map((block) => {
				const draft = this.#drafts[block.id];
				const title = (draft ?? block.body).split("\n", 1)[0]?.trim() ?? "";
				return {
					id: block.id,
					title: title || UNTITLED,
					dirty: draft !== undefined && draft !== block.body,
				};
			});
	}

	get selectedId(): string | null {
		return this.#selectedId;
	}

	get text(): string {
		const id = this.#selectedId;
		return id ? (this.#drafts[id] ?? this.#bodyOf(id) ?? "") : "";
	}

	get version(): number | null {
		return this.#committed?.version ?? null;
	}

	get status(): SaveStatus {
		return this.#status;
	}

	get statusMessage(): string {
		return this.#statusMessage;
	}

	get busy(): boolean {
		return this.#busy;
	}

	get canRetry(): boolean {
		return !this.#busy && (this.#failed !== null || this.#backendPending);
	}

	/** Loads the committed read model; safe to call again to reload. Never rejects. */
	async load(): Promise<boolean> {
		const generation = ++this.#loadGeneration;
		try {
			const view = await this.#port.view();
			if (this.#stale(generation)) return false;
			this.#committed = view;
			this.#loadState = "ready";
			this.#ensureSelection();
			return true;
		} catch (error) {
			if (!this.#stale(generation)) this.#recordLoadFailure(asCommandError(error));
			return false;
		}
	}

	select(id: string): void {
		if (this.#committed?.blocks.some((block) => block.id === id && block.parentId === null)) {
			this.#selectedId = id;
		}
	}

	input(text: string): void {
		if (!this.#selectedId) return;
		this.#setDraft(this.#selectedId, text);
		if (this.#status === "saved" || this.#status === "conflict") this.#status = "idle";
	}

	/** Saves the selected draft. A save requested while busy runs after the current one. */
	async save(): Promise<void> {
		if (this.#busy) {
			this.#saveQueued = true;
			return;
		}
		const id = this.#selectedId;
		const committed = this.#committed;
		if (!id || !committed || this.#blocked()) return;
		const draft = this.#drafts[id];
		if (draft === undefined) return;
		if (draft === this.#bodyOf(id)) {
			this.#setDraft(id, undefined);
			return;
		}
		await this.#run({
			kind: "body",
			request: {
				requestId: this.#newRequestId(),
				baseVersion: committed.version,
				blockId: id,
				body: draft,
			},
		});
	}

	async createDocument(): Promise<void> {
		if (this.#busy || !this.#committed || this.#blocked()) return;
		this.#busy = true;
		let blockId: string;
		try {
			blockId = await this.#port.newBlockId();
		} catch (error) {
			if (!this.#disposed) this.#fail(asCommandError(error).message);
			return;
		} finally {
			this.#busy = false;
		}
		const committed = this.#committed;
		if (this.#disposed || !committed) return;
		await this.#run({
			kind: "create",
			request: { requestId: this.#newRequestId(), baseVersion: committed.version, blockId },
		});
	}

	/** Resends the failed mutation unchanged, or asks the backend to persist its pending change. */
	async retry(): Promise<void> {
		if (this.#busy) return;
		if (this.#failed) {
			await this.#run(this.#failed);
		} else if (this.#backendPending) {
			await this.#retryBackend();
		}
	}

	dispose(): void {
		this.#disposed = true;
		this.#loadGeneration += 1;
	}

	async #run(mutation: Mutation): Promise<void> {
		this.#busy = true;
		this.#status = "saving";
		this.#statusMessage = "";
		try {
			if (mutation.kind === "body") await this.#port.updateBody(mutation.request);
			else await this.#port.createDocument(mutation.request);
			if (this.#disposed) return;
			await this.#publish(mutation);
		} catch (error) {
			if (!this.#disposed) await this.#recordFailure(asCommandError(error), mutation);
		} finally {
			this.#busy = false;
		}
		if (this.#saveQueued && !this.#disposed) {
			this.#saveQueued = false;
			await this.save();
		}
	}

	/** After a durable mutation: reload the committed state, then settle the draft/selection. */
	async #publish(mutation: Mutation): Promise<void> {
		this.#failed = null;
		this.#backendPending = false;
		await this.load();
		if (this.#disposed) return;
		const { blockId } = mutation.request;
		if (mutation.kind === "create") this.#selectedId = blockId;
		else if (this.#drafts[blockId] === mutation.request.body) this.#setDraft(blockId, undefined);
		this.#status = "saved";
	}

	async #recordFailure(error: WorkspaceCommandError, mutation: Mutation): Promise<void> {
		if (error.kind === "stale_version") {
			this.#failed = null;
			this.#status = "conflict";
			this.#statusMessage = CONFLICT_MESSAGE;
			await this.load();
			return;
		}
		if (error.kind === "persist_pending") {
			this.#failed = null;
			this.#backendPending = true;
		} else {
			this.#failed = FINAL_KINDS.has(error.kind) ? null : mutation;
		}
		this.#fail(error.message);
	}

	#recordLoadFailure(error: WorkspaceCommandError): void {
		if (error.kind === "persist_pending") {
			this.#backendPending = true;
			this.#fail(PENDING_MESSAGE);
		} else if (this.#loadState !== "ready" || error.kind === "workspace_unavailable") {
			this.#loadState = "unavailable";
			this.#unavailableMessage = error.message;
		} else {
			this.#fail(error.message);
		}
	}

	async #retryBackend(): Promise<void> {
		this.#busy = true;
		this.#status = "saving";
		try {
			await this.#port.retrySave();
			if (this.#disposed) return;
			this.#backendPending = false;
			await this.load();
			this.#status = "saved";
		} catch (error) {
			if (!this.#disposed) this.#fail(asCommandError(error).message);
		} finally {
			this.#busy = false;
		}
	}

	#fail(message: string): void {
		this.#status = "failed";
		this.#statusMessage = message;
	}

	#blocked(): boolean {
		return this.#failed !== null || this.#backendPending;
	}

	#stale(generation: number): boolean {
		return this.#disposed || generation !== this.#loadGeneration;
	}

	#bodyOf(id: string): string | undefined {
		return this.#committed?.blocks.find((block) => block.id === id)?.body;
	}

	#setDraft(id: string, text: string | undefined): void {
		const next = { ...this.#drafts };
		if (text === undefined) delete next[id];
		else next[id] = text;
		this.#drafts = next;
	}

	#ensureSelection(): void {
		const roots = this.#committed?.blocks.filter((block) => block.parentId === null) ?? [];
		if (!roots.some((block) => block.id === this.#selectedId)) {
			this.#selectedId = roots[0]?.id ?? null;
		}
	}
}

export function createBodyEditorController(
	port: WorkspacePort,
	newRequestId: () => string = () => crypto.randomUUID(),
): BodyEditorController {
	return new BodyEditorController(port, newRequestId);
}

function asCommandError(error: unknown): WorkspaceCommandError {
	if (error instanceof WorkspaceCommandError) return error;
	return new WorkspaceCommandError("transport", "バックエンドに接続できませんでした。", {
		cause: error,
	});
}
