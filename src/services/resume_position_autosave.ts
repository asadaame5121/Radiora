type TimerHandle = number | ReturnType<typeof globalThis.setTimeout>;

interface PendingResumePosition {
	occurrenceId: string;
	caretOffset: number;
	version: number;
	savedVersion: number;
	timer?: TimerHandle;
	worker?: Promise<void>;
}

export interface ResumePositionAutosaveOptions {
	save(occurrenceId: string, caretOffset: number): Promise<void>;
	onError?(cause: unknown): void;
	delayMs?: number;
	setTimer?(callback: () => void, delayMs: number): TimerHandle;
	clearTimer?(timer: TimerHandle): void;
}

/** Debounces resume writes and keeps one serial worker so the latest input always wins. */
export class ResumePositionAutosaveCoordinator {
	readonly #save: ResumePositionAutosaveOptions["save"];
	readonly #onError?: ResumePositionAutosaveOptions["onError"];
	readonly #delayMs: number;
	readonly #setTimer: NonNullable<ResumePositionAutosaveOptions["setTimer"]>;
	readonly #clearTimer: NonNullable<ResumePositionAutosaveOptions["clearTimer"]>;
	#pending: PendingResumePosition | null = null;

	constructor(options: ResumePositionAutosaveOptions) {
		this.#save = options.save;
		this.#onError = options.onError;
		this.#delayMs = options.delayMs ?? 250;
		this.#setTimer = options.setTimer ??
			((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
		this.#clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
	}

	queue(occurrenceId: string, caretOffset: number): void {
		const pending = this.#pending ?? {
			occurrenceId,
			caretOffset,
			version: 0,
			savedVersion: 0,
		};
		if (pending.timer !== undefined) this.#clearTimer(pending.timer);
		pending.occurrenceId = occurrenceId;
		pending.caretOffset = caretOffset;
		pending.version++;
		pending.timer = this.#setTimer(() => {
			pending.timer = undefined;
			void this.flush().catch((cause) => this.#onError?.(cause));
		}, this.#delayMs);
		this.#pending = pending;
	}

	async flush(): Promise<void> {
		const pending = this.#pending;
		if (!pending) return;
		if (pending.timer !== undefined) {
			this.#clearTimer(pending.timer);
			pending.timer = undefined;
		}
		if (pending.worker) return pending.worker;
		pending.worker = this.#runWorker(pending);
		try {
			await pending.worker;
		} finally {
			pending.worker = undefined;
		}
	}

	async #runWorker(pending: PendingResumePosition): Promise<void> {
		while (pending.savedVersion < pending.version) {
			const savingVersion = pending.version;
			const occurrenceId = pending.occurrenceId;
			const caretOffset = pending.caretOffset;
			await this.#save(occurrenceId, caretOffset);
			pending.savedVersion = savingVersion;
		}
	}
}
