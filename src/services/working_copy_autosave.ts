export type WorkingCopySavePhase = "saved" | "unsaved" | "saving" | "failed";

export interface WorkingCopySaveStatus {
	workId: string;
	phase: WorkingCopySavePhase;
	error?: string;
}

export interface WorkingCopyDraft {
	workId: string;
	occurrenceId: string;
	text: string;
	status: WorkingCopySaveStatus;
}

interface PendingWorkingCopy {
	workId: string;
	occurrenceId: string;
	text: string;
	version: number;
	savedVersion: number;
	timer?: number;
	worker?: Promise<void>;
	status: WorkingCopySaveStatus;
}

export interface WorkingCopyAutosaveOptions {
	save(occurrenceId: string, text: string): Promise<void>;
	onStatusChange?(statuses: WorkingCopySaveStatus[]): void;
	delayMs?: number;
	setTimer?(callback: () => void, delayMs: number): number;
	clearTimer?(timer: number): void;
}

/**
 * Serializes Working Copy writes per Work. A failed or in-flight draft remains
 * available to the UI so a subsequent reload cannot silently replace it.
 */
export class WorkingCopyAutosaveCoordinator {
	readonly #entries = new Map<string, PendingWorkingCopy>();
	readonly #save: WorkingCopyAutosaveOptions["save"];
	readonly #onStatusChange?: WorkingCopyAutosaveOptions["onStatusChange"];
	readonly #delayMs: number;
	readonly #setTimer: NonNullable<WorkingCopyAutosaveOptions["setTimer"]>;
	readonly #clearTimer: NonNullable<WorkingCopyAutosaveOptions["clearTimer"]>;

	constructor(options: WorkingCopyAutosaveOptions) {
		this.#save = options.save;
		this.#onStatusChange = options.onStatusChange;
		this.#delayMs = options.delayMs ?? 250;
		this.#setTimer = options.setTimer ??
			((callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number);
		this.#clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
	}

	queue(workId: string, occurrenceId: string, text: string): void {
		const existing = this.#entries.get(workId);
		if (existing?.timer !== undefined) this.#clearTimer(existing.timer);
		const entry: PendingWorkingCopy = existing ?? {
			workId,
			occurrenceId,
			text,
			version: 0,
			savedVersion: 0,
			status: { workId, phase: "saved" },
		};
		entry.occurrenceId = occurrenceId;
		entry.text = text;
		entry.version++;
		entry.status = { workId, phase: "unsaved" };
		entry.timer = this.#setTimer(() => {
			entry.timer = undefined;
			void this.flush(workId).catch(() => {
				// Failure is deliberately represented by status and the retained draft.
			});
		}, this.#delayMs);
		this.#entries.set(workId, entry);
		this.#emit();
	}

	async flush(workId?: string): Promise<void> {
		if (workId !== undefined) {
			const entry = this.#entries.get(workId);
			if (entry) await this.#flushEntry(entry);
			return;
		}
		const results = await Promise.allSettled(
			[...this.#entries.values()].map((entry) => this.#flushEntry(entry)),
		);
		const rejected = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (rejected) throw rejected.reason;
	}

	retry(workId?: string): Promise<void> {
		return this.flush(workId);
	}

	statuses(): WorkingCopySaveStatus[] {
		return [...this.#entries.values()].map((entry) => ({ ...entry.status }));
	}

	drafts(): WorkingCopyDraft[] {
		return [...this.#entries.values()]
			.filter((entry) => entry.savedVersion < entry.version)
			.map((entry) => ({
				workId: entry.workId,
				occurrenceId: entry.occurrenceId,
				text: entry.text,
				status: { ...entry.status },
			}));
	}

	hasUnsavedChanges(): boolean {
		return [...this.#entries.values()].some((entry) => entry.savedVersion < entry.version);
	}

	async #flushEntry(entry: PendingWorkingCopy): Promise<void> {
		if (entry.timer !== undefined) {
			this.#clearTimer(entry.timer);
			entry.timer = undefined;
		}
		if (entry.worker) return entry.worker;
		entry.worker = this.#runWorker(entry);
		try {
			await entry.worker;
		} finally {
			entry.worker = undefined;
		}
	}

	async #runWorker(entry: PendingWorkingCopy): Promise<void> {
		while (entry.savedVersion < entry.version) {
			const savingVersion = entry.version;
			const occurrenceId = entry.occurrenceId;
			const text = entry.text;
			entry.status = { workId: entry.workId, phase: "saving" };
			this.#emit();
			try {
				await this.#save(occurrenceId, text);
			} catch (cause) {
				entry.status = {
					workId: entry.workId,
					phase: "failed",
					error: cause instanceof Error ? cause.message : String(cause),
				};
				this.#emit();
				throw cause;
			}
			entry.savedVersion = savingVersion;
		}
		entry.status = { workId: entry.workId, phase: "saved" };
		this.#emit();
	}

	#emit(): void {
		this.#onStatusChange?.(this.statuses());
	}
}
