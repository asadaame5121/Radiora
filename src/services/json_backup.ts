import {
	type GraphStateSnapshot,
	type GraphStore,
	validatedGraphStateSnapshot,
} from "../storage/graph_store.ts";

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

export interface JsonBackupRestoreResult {
	workCount: number;
	occurrenceCount: number;
	revisionCount: number;
	recoverySnapshotCount: number;
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

	async restore(source: string): Promise<JsonBackupRestoreResult> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(source);
		} catch {
			throw new Error("バックアップJSONを解析できません。");
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("バックアップenvelopeが必要です。");
		}
		const envelope = parsed as Record<string, unknown>;
		if (envelope.format !== "radiora-backup") {
			throw new Error("Radioraバックアップ形式ではありません。");
		}
		if (envelope.schemaVersion !== CURRENT_BACKUP_SCHEMA_VERSION) {
			throw new Error(`現在のbackup schema version 6が必要です: ${envelope.schemaVersion}`);
		}
		const state = validatedGraphStateSnapshot(envelope.data);
		await this.store.restoreGraphState(state);
		return {
			workCount: state.works.length,
			occurrenceCount: state.occurrences.length,
			revisionCount: state.revisions.length,
			recoverySnapshotCount: state.recoverySnapshots.length,
		};
	}
}
