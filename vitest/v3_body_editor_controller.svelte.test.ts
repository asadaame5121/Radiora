import { describe, expect, test } from "vitest";
import { createBodyEditorController } from "../src/v3/body_editor_controller.svelte.ts";
import type {
	CreateDocumentRequest,
	Saved,
	UpdateBodyRequest,
	WorkspaceView,
} from "../src/v3/workspace_dto.ts";
import { WorkspaceCommandError, type WorkspacePort } from "../src/v3/workspace_port.ts";

const A = "0190a6e0-0000-7000-8000-000000000001";
const B = "0190a6e0-0000-7000-8000-000000000002";

type Failure = WorkspaceCommandError | null;

/**
 * A small backend model: committed bodies, receipts by request ID (resends are recognised),
 * and failures injected per call. Each call can also be held to control completion order.
 */
function fakeBackend(initial: Record<string, string> = {}) {
	const bodies = new Map(Object.entries(initial));
	const receipts = new Map<string, Saved>();
	let version = 0;
	const calls: string[] = [];
	const nextFailures: Failure[] = [];
	let hold: Promise<void> | null = null;
	let loseNextResponse = false;
	const applied: string[] = [];

	const view = (): WorkspaceView => ({
		version,
		blocks: [...bodies].map(([id, body], index) => ({ id, parentId: null, index, body })),
	});

	async function gate(name: string): Promise<void> {
		calls.push(name);
		if (hold) await hold;
		const failure = nextFailures.shift();
		if (failure) throw failure;
	}

	function commit(requestId: string, apply: () => void): Saved {
		const recorded = receipts.get(requestId);
		if (recorded) return { ...recorded, replayed: true };
		apply();
		applied.push(requestId);
		version += 1;
		const saved = { version, replayed: false };
		receipts.set(requestId, saved);
		return saved;
	}

	const port: WorkspacePort = {
		async view() {
			await gate("view");
			return view();
		},
		async newBlockId() {
			await gate("newBlockId");
			return B;
		},
		async createDocument(request: CreateDocumentRequest) {
			await gate("createDocument");
			return commit(request.requestId, () => bodies.set(request.blockId, ""));
		},
		async updateBody(request: UpdateBodyRequest) {
			await gate("updateBody");
			if (request.baseVersion !== version && !receipts.has(request.requestId)) {
				throw new WorkspaceCommandError("stale_version", "stale", { currentVersion: version });
			}
			const saved = commit(request.requestId, () => bodies.set(request.blockId, request.body));
			if (loseNextResponse) {
				loseNextResponse = false;
				throw new WorkspaceCommandError("transport", "response lost after commit");
			}
			return saved;
		},
		async retrySave() {
			await gate("retrySave");
			return { version, replayed: false };
		},
	};

	return {
		port,
		bodies,
		calls,
		applied,
		/** The next body update commits, then its response is lost. */
		loseNextResponse() {
			loseNextResponse = true;
		},
		failNext(...failures: Failure[]) {
			nextFailures.push(...failures);
		},
		/** Holds every call until the returned release function runs. */
		holdCalls(): () => void {
			let release: () => void = () => undefined;
			hold = new Promise<void>((resolve) => {
				release = () => {
					hold = null;
					resolve();
				};
			});
			return release;
		},
		/** Another writer changes the workspace. */
		bump(id: string, body: string) {
			bodies.set(id, body);
			version += 1;
		},
	};
}

function ids() {
	let n = 0;
	return () => {
		n += 1;
		return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
	};
}

async function ready(initial: Record<string, string> = { [A]: "first line\nmore" }) {
	const backend = fakeBackend(initial);
	const controller = createBodyEditorController(backend.port, ids());
	await controller.load();
	return { backend, controller };
}

const persistFailed = () => new WorkspaceCommandError("persist_failed", "保存に失敗しました。");

describe("v3 body editor controller", () => {
	test("loads the committed documents and selects the first", async () => {
		const { controller } = await ready();
		expect(controller.loadState).toBe("ready");
		expect(controller.documents).toEqual([{ id: A, title: "first line", dirty: false }]);
		expect(controller.selectedId).toBe(A);
		expect(controller.text).toBe("first line\nmore");
	});

	test("an unavailable workspace is reported instead of the editor", async () => {
		const backend = fakeBackend();
		backend.failNext(
			new WorkspaceCommandError("workspace_unavailable", "別のRadiora v3が開いています。"),
		);
		const controller = createBodyEditorController(backend.port, ids());
		await controller.load();
		expect(controller.loadState).toBe("unavailable");
		expect(controller.unavailableMessage).toBe("別のRadiora v3が開いています。");
	});

	test("saving publishes the committed body and drops the draft", async () => {
		const { backend, controller } = await ready();
		controller.input("edited");
		expect(controller.documents[0]).toMatchObject({ title: "edited", dirty: true });
		await controller.save();
		expect(backend.bodies.get(A)).toBe("edited");
		expect(controller.status).toBe("saved");
		expect(controller.documents[0]?.dirty).toBe(false);
		expect(controller.version).toBe(1);
	});

	test("a failed save keeps the draft and retry resends the same request once", async () => {
		const { backend, controller } = await ready();
		controller.input("keep me");
		backend.failNext(persistFailed());
		await controller.save();
		expect(controller.status).toBe("failed");
		expect(controller.canRetry).toBe(true);
		expect(controller.text).toBe("keep me");
		expect(backend.bodies.get(A)).toBe("first line\nmore");

		await controller.retry();
		expect(controller.status).toBe("saved");
		expect(backend.bodies.get(A)).toBe("keep me");
		expect(backend.applied).toHaveLength(1);
	});

	test("a response lost after commit is retried with the same request and not applied twice", async () => {
		const { backend, controller } = await ready();
		controller.input("once");
		backend.loseNextResponse();
		await controller.save();
		expect(backend.bodies.get(A)).toBe("once");
		expect(controller.status).toBe("failed");
		expect(controller.canRetry).toBe(true);
		expect(controller.text).toBe("once");

		await controller.retry();
		expect(backend.applied).toHaveLength(1);
		expect(controller.status).toBe("saved");
		expect(controller.documents[0]?.dirty).toBe(false);
	});

	test("typing during a save keeps the newer draft", async () => {
		const { backend, controller } = await ready();
		controller.input("v1");
		const release = backend.holdCalls();
		const saving = controller.save();
		controller.input("v2");
		release();
		await saving;
		expect(backend.bodies.get(A)).toBe("v1");
		expect(controller.text).toBe("v2");
		expect(controller.documents[0]?.dirty).toBe(true);
	});

	test("a save requested while busy runs after the current one", async () => {
		const { backend, controller } = await ready();
		controller.input("v1");
		const release = backend.holdCalls();
		const first = controller.save();
		controller.input("v2");
		const second = controller.save();
		release();
		await Promise.all([first, second]);
		expect(backend.bodies.get(A)).toBe("v2");
		expect(controller.documents[0]?.dirty).toBe(false);
	});

	test("a stale save reloads the latest committed state and keeps the draft", async () => {
		const { backend, controller } = await ready();
		backend.bump(A, "changed elsewhere");
		controller.input("mine");
		await controller.save();
		expect(controller.status).toBe("conflict");
		expect(controller.version).toBe(1);
		expect(controller.text).toBe("mine");
		await controller.save();
		expect(backend.bodies.get(A)).toBe("mine");
	});

	test("creating a document selects it after it is durable", async () => {
		const { backend, controller } = await ready();
		await controller.createDocument();
		expect(backend.bodies.has(B)).toBe(true);
		expect(controller.selectedId).toBe(B);
		expect(controller.documents.map((document) => document.title)).toEqual(["first line", "無題"]);
	});

	test("an older load response never overwrites a newer one", async () => {
		const { backend, controller } = await ready();
		const release = backend.holdCalls();
		const older = controller.load();
		release();
		backend.bump(A, "newest");
		const newer = controller.load();
		await Promise.all([older, newer]);
		expect(controller.text).toBe("newest");
	});

	test("nothing is published after dispose", async () => {
		const { backend, controller } = await ready();
		controller.input("late");
		const release = backend.holdCalls();
		const saving = controller.save();
		controller.dispose();
		release();
		await saving;
		expect(controller.status).toBe("saving");
	});

	test("a backend with a pending change of an unknown request is retried by retrySave", async () => {
		const { backend, controller } = await ready();
		backend.failNext(new WorkspaceCommandError("persist_pending", "pending"));
		await controller.load();
		expect(controller.canRetry).toBe(true);
		await controller.retry();
		expect(backend.calls).toContain("retrySave");
		expect(controller.status).toBe("saved");
	});
});
