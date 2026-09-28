import type { StartupSnapshotCache } from "../services/startup_snapshot_cache.ts";
import type { StartupStatus } from "../shared/bindings.ts";

export interface StartupApi {
	getStartupStatus(): Promise<StartupStatus>;
	retryStartup(): Promise<StartupStatus>;
	loadStartupSnapshotCache(): Promise<StartupSnapshotCache | null>;
}

export interface StartupControllerOptions {
	api: StartupApi;
	errorMessage: (cause: unknown) => string;
	onCacheRestored?: (cache: StartupSnapshotCache) => void;
	onReady?: () => Promise<void>;
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

	constructor(private readonly options: StartupControllerOptions) {}

	get cancelled(): boolean {
		return this.#cancelled;
	}

	dispose = (): void => {
		this.#cancelled = true;
	};

	restoreCache = async (): Promise<void> => {
		try {
			const cache = await this.options.api.loadStartupSnapshotCache();
			if (this.#cancelled || this.dataLoaded || !cache) return;
			this.options.onCacheRestored?.(cache);
			this.cacheActive = true;
			// biome-ignore lint/plugin/noSwallowedRejection: The startup cache is optional and normal startup remains available.
		} catch {
			// The startup cache is optional; continue with normal startup.
		}
	};

	monitor = async (): Promise<void> => {
		const pollInterval = this.options.pollIntervalMs ?? DEFAULT_STARTUP_POLL_INTERVAL_MS;
		while (!this.#cancelled) {
			try {
				this.status = await this.options.api.getStartupStatus();
				if (this.status.phase === "ready") {
					if (this.options.onReady) {
						await this.options.onReady();
					}
					return;
				}
			} catch (cause) {
				this.status = {
					phase: "failed",
					message: "起動状態を取得できませんでした。",
					detail: this.options.errorMessage(cause),
				};
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}
	};

	retry = async (): Promise<void> => {
		this.status = {
			phase: "starting",
			message: "再試行しています…",
			logPath: this.status.logPath,
		};
		try {
			this.status = await this.options.api.retryStartup();
			if (this.status.phase === "ready" && this.options.onReady) {
				await this.options.onReady();
			}
		} catch (cause) {
			this.status = {
				phase: "failed",
				message: "再試行に失敗しました。",
				detail: this.options.errorMessage(cause),
			};
		}
	};

	markDataLoaded = (): void => {
		this.dataLoaded = true;
		this.cacheActive = false;
	};
}
