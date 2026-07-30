import type { GraphStateSnapshot, GraphStore } from "../storage/graph_store.ts";

export const CURRENT_BACKUP_SCHEMA_VERSION = 6;
export const CURRENT_STORAGE_SCHEMA_VERSION = 6;
const APP_VERSION = "0.1.0";

export interface JsonBackupV6 {
	format: "radiora-backup";
	schemaVersion: 6;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 6 };
	data: GraphStateSnapshot;
}

export class JsonBackupService {
	constructor(private readonly store: GraphStore) {}

	async export(now = new Date()): Promise<string> {
		const exportedAt = now.toISOString();
		const backup: JsonBackupV6 = {
			format: "radiora-backup",
			schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
			exportedAt,
			appVersion: APP_VERSION,
			source: { storageSchemaVersion: CURRENT_STORAGE_SCHEMA_VERSION },
			data: await this.store.exportGraphState(),
		};
		return JSON.stringify(backup, null, 2);
	}
}
