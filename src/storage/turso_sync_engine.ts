import type { TursoGraphStore, TursoSyncResult } from "./turso_store.ts";
import {
	type SanitizedSyncLogConfig,
	sanitizeSyncConfigForLog,
	type TursoSyncConfig,
	type TursoSyncStatus,
} from "./turso_sync_config.ts";

export interface TursoSyncEngineOptions {
	store: TursoGraphStore;
	syncConfig: TursoSyncConfig | null;
	onStatusChange?: (status: TursoSyncStatus) => void;
	onLog?: (event: string, fields: Record<string, unknown>) => void;
}

export class TursoSyncEngine {
	private status: TursoSyncStatus = "disabled";
	private readonly store: TursoGraphStore;
	private readonly syncConfig: TursoSyncConfig | null;
	private readonly onStatusChange?: (status: TursoSyncStatus) => void;
	private readonly onLog?: (event: string, fields: Record<string, unknown>) => void;
	private syncPromise: Promise<TursoSyncResult> | null = null;
	private intervalTimer: ReturnType<typeof setInterval> | null = null;

	constructor(options: TursoSyncEngineOptions) {
		this.store = options.store;
		this.syncConfig = options.syncConfig;
		this.onStatusChange = options.onStatusChange;
		this.onLog = options.onLog;
	}

	async initialize(): Promise<void> {
		if (!this.syncConfig) {
			this.setStatus("disabled");
			return;
		}
		this.log("storage.turso_sync.initialized", {
			config: sanitizeSyncConfigForLog(this.syncConfig),
		});
		this.setStatus(this.store.getSyncStatus());
		await this.sync();

		if (this.syncConfig.syncIntervalMs) {
			this.intervalTimer = setInterval(() => {
				void this.sync().catch(() => this.setStatus("offline"));
			}, this.syncConfig.syncIntervalMs);
		}
	}

	getStatus(): TursoSyncStatus {
		return this.status;
	}

	getSanitizedConfig(): SanitizedSyncLogConfig | null {
		return this.syncConfig ? sanitizeSyncConfigForLog(this.syncConfig) : null;
	}

	async sync(): Promise<TursoSyncResult> {
		if (!this.syncConfig) {
			return { status: "disabled" };
		}
		if (this.syncPromise) return this.syncPromise;

		this.syncPromise = this.executeSyncCycle().finally(() => {
			this.syncPromise = null;
		});
		return this.syncPromise;
	}

	private async executeSyncCycle(): Promise<TursoSyncResult> {
		if (!this.syncConfig) return { status: "disabled" };
		this.setStatus("syncing");
		this.log("storage.turso_sync.begin", {
			config: sanitizeSyncConfigForLog(this.syncConfig),
		});

		const result = await this.store.sync();
		this.setStatus(result.status);

		if (result.status === "synced") {
			this.log("storage.turso_sync.success", {
				config: sanitizeSyncConfigForLog(this.syncConfig),
			});
		} else {
			this.log("storage.turso_sync.failed", {
				config: sanitizeSyncConfigForLog(this.syncConfig),
				status: result.status,
			});
		}
		return result;
	}

	private setStatus(next: TursoSyncStatus): void {
		if (this.status === next) return;
		this.status = next;
		this.onStatusChange?.(next);
	}

	private log(event: string, fields: Record<string, unknown>): void {
		this.onLog?.(event, fields);
	}

	async close(): Promise<void> {
		if (this.intervalTimer !== null) {
			clearInterval(this.intervalTimer);
			this.intervalTimer = null;
		}
	}
}
