import type { OutlineSnapshot } from "../domain/models.ts";
import type { BrowsingLocation } from "../services/browsing_navigation_state.ts";
import type { StartupSnapshotCache } from "../services/startup_snapshot_cache.ts";
import type { StartupStatus } from "../shared/bindings.ts";

export interface StartupApi {
	getStartupStatus(): Promise<StartupStatus>;
	retryStartup(): Promise<StartupStatus>;
	loadStartupSnapshotCache(): Promise<StartupSnapshotCache | null>;
	saveStartupSnapshotCache?(
		snapshot: OutlineSnapshot,
		location?: BrowsingLocation,
	): Promise<void>;
}

export interface StartupControllerOptions {
	api: StartupApi;
	errorMessage: (cause: unknown) => string;
	onCacheRestored?: (cache: StartupSnapshotCache) => boolean;
	onReady?: (current: () => boolean) => Promise<void>;
	onReadyError?: (cause: unknown) => void;
	pollIntervalMs?: number;
}

const DEFAULT_STARTUP_POLL_INTERVAL_MS = 250;

export class StartupController {
	status = $state<StartupStatus>({
		phase: "starting",
		message: "Radioraを起動しています…",
	});
	cacheActive = $state(false);
	dataLoaded = $state(false);
	#cancelled = false;
	#generation = 0;
	#cacheGeneration = 0;
	#cancelWait: (() => void) | null = null;

	constructor(private readonly options: StartupControllerOptions) {}

	get cancelled(): boolean {
		return this.#cancelled;
	}

	/** A new App mount opens a fresh session; callbacks from the previous one stay invalid. */
	start = async (): Promise<void> => {
		this.invalidateDataLoad();
		this.#cancelled = false;
		this.dataLoaded = false;
		this.cacheActive = false;
		this.status = { phase: "starting", message: "Radioraを起動しています…" };
		const monitor = this.monitor();
		await Promise.all([monitor, this.restoreCache()]);
	};

	dispose = (): void => {
		this.#cancelled = true;
		this.invalidateDataLoad();
	};

	saveSnapshotCache = (
		snapshot: OutlineSnapshot,
		location?: BrowsingLocation,
		canSave: () => boolean = () => true,
	): void => {
		if (
			this.cacheActive ||
			this.status.phase !== "ready" ||
			!canSave() ||
			!this.options.api.saveStartupSnapshotCache
		) {
			return;
		}
		// biome-ignore lint/plugin/noSwallowedRejection: Startup acceleration is optional and must not interrupt editing.
		void this.options.api.saveStartupSnapshotCache(snapshot, location).catch(() => {
			// Startup acceleration must not interrupt editing when the cache cannot be written.
		});
	};

	/** Normal Outline loads revoke pending startup publication, without owning their state here. */
	invalidateDataLoad = (): void => {
		this.#generation++;
		this.#cancelWait?.();
	};

	#current = (): () => boolean => {
		const generation = this.#generation;
		return () => !this.#cancelled && generation === this.#generation;
	};

	restoreCache = async (): Promise<void> => {
		const requestCurrent = this.#current();
		const generation = ++this.#cacheGeneration;
		const current = () => requestCurrent() && generation === this.#cacheGeneration;
		if (!current()) return;
		try {
			const cache = await this.options.api.loadStartupSnapshotCache();
			if (!current() || this.dataLoaded || !cache) return;
			if (!this.options.onCacheRestored?.(cache)) return;
			if (current() && !this.dataLoaded) this.cacheActive = true;
			// biome-ignore lint/plugin/noSwallowedRejection: The startup cache is optional and normal startup remains available.
		} catch {
			// The startup cache is optional; continue with normal startup.
		}
	};

	monitor = async (): Promise<void> => {
		if (this.#cancelled) return;
		this.invalidateDataLoad();
		await this.#poll(this.#current());
	};

	#poll = async (current: () => boolean): Promise<void> => {
		const pollInterval = this.options.pollIntervalMs ?? DEFAULT_STARTUP_POLL_INTERVAL_MS;
		while (current()) {
			let nextStatus: StartupStatus;
			try {
				nextStatus = await this.options.api.getStartupStatus();
			} catch (cause) {
				if (!current()) return;
				this.status = {
					phase: "failed",
					message: "起動状態を取得できませんでした。",
					detail: this.options.errorMessage(cause),
				};
				return;
			}
			if (!current()) return;
			this.status = nextStatus;
			if (this.status.phase === "ready") {
				await this.#handleReady(current);
				return;
			}
			if (this.status.phase === "failed") return;
			await this.#wait(pollInterval);
		}
	};

	#handleReady = async (current: () => boolean): Promise<void> => {
		if (!this.options.onReady) return;
		try {
			await this.options.onReady(current);
		} catch (cause) {
			if (!current()) return;
			if (!this.dataLoaded) {
				this.status = {
					phase: "failed",
					message: "初期データの読み込みに失敗しました。",
					detail: this.options.errorMessage(cause),
					logPath: this.status.logPath,
				};
			} else {
				this.options.onReadyError?.(cause);
			}
		}
	};

	retry = async (): Promise<void> => {
		if (this.#cancelled) return;
		this.invalidateDataLoad();
		const current = this.#current();
		this.status = {
			phase: "starting",
			message: "再試行しています…",
			logPath: this.status.logPath,
		};
		try {
			const nextStatus = await this.options.api.retryStartup();
			if (!current()) return;
			this.status = nextStatus;
		} catch (cause) {
			if (!current()) return;
			this.status = {
				phase: "failed",
				message: "再試行に失敗しました。",
				detail: this.options.errorMessage(cause),
			};
			return;
		}
		if (!current()) return;
		if (this.status.phase === "ready") {
			await this.#handleReady(current);
		} else if (this.status.phase !== "failed") {
			await this.#poll(current);
		}
	};

	reloadData = async (): Promise<void> => {
		if (this.#cancelled) return;
		this.invalidateDataLoad();
		await this.#handleReady(this.#current());
	};

	#wait = (delay: number): Promise<void> =>
		new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				this.#cancelWait = null;
				resolve();
			};
			const timer = setTimeout(finish, delay);
			this.#cancelWait = finish;
		});

	markDataLoaded = (current = this.#current()): void => {
		if (!current()) return;
		this.dataLoaded = true;
		this.cacheActive = false;
	};
}
