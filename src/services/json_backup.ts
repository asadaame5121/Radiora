import {
	type BackupStorePort,
	type GraphStateSnapshot,
	validatedGraphStateSnapshot,
} from "../storage/graph_store.ts";
import { APP_VERSION } from "../shared/app_version.ts";
import {
	type BackupV0,
	migrateBackupV0,
	migrateBackupV1,
	migrateBackupV2,
	migrateBackupV3,
	migrateBackupV4,
	migrateBackupV5,
	type StoredGraphV1,
	type StoredGraphV2,
	type StoredGraphV3,
	type StoredGraphV4,
	type StoredGraphV5,
	type StoredGraphV6,
} from "../storage/backup_migrations.ts";

export const CURRENT_BACKUP_SCHEMA_VERSION = 6;
export const CURRENT_STORAGE_SCHEMA_VERSION = 6;

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
	constructor(private readonly store: BackupStorePort) {}

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
		const state = decodeBackupState(envelope);
		await this.store.restoreGraphState(state);
		return {
			workCount: state.works.length,
			occurrenceCount: state.occurrences.length,
			revisionCount: state.revisions.length,
			recoverySnapshotCount: state.recoverySnapshots.length,
		};
	}
}

export function decodeBackupState(envelope: Record<string, unknown>): GraphStateSnapshot {
	if (!Object.hasOwn(envelope, "schemaVersion")) {
		return validatedGraphStateSnapshot(migrateBackupV5(
			migrateBackupV4(
				migrateBackupV3(
					migrateBackupV2(
						migrateBackupV1(migrateBackupV0(envelope as unknown as BackupV0)),
					),
				),
			),
		));
	}
	if (envelope.format !== "radiora-backup") {
		throw new Error("Radioraバックアップ形式ではありません。");
	}
	const version = envelope.schemaVersion;
	if (!Number.isInteger(version) || (version as number) < 1) {
		throw new Error(`不正なbackup schema versionです: ${version}`);
	}
	if ((version as number) > CURRENT_BACKUP_SCHEMA_VERSION) {
		throw new Error(
			`backup schema version ${version} はこのアプリより新しいため復元できません。`,
		);
	}
	const data = envelope.data;
	let migrated: StoredGraphV6;
	switch (version) {
		case 1:
			migrated = migrateBackupV5(
				migrateBackupV4(
					migrateBackupV3(
						migrateBackupV2(migrateBackupV1(data as StoredGraphV1)),
					),
				),
			);
			break;
		case 2:
			migrated = migrateBackupV5(
				migrateBackupV4(migrateBackupV3(migrateBackupV2(data as StoredGraphV2))),
			);
			break;
		case 3:
			migrated = migrateBackupV5(
				migrateBackupV4(migrateBackupV3(data as StoredGraphV3)),
			);
			break;
		case 4:
			migrated = migrateBackupV5(migrateBackupV4(data as StoredGraphV4));
			break;
		case 5:
			migrated = migrateBackupV5(data as StoredGraphV5);
			break;
		case 6:
			migrated = data as StoredGraphV6;
			break;
		default:
			throw new Error(`未対応のbackup schema versionです: ${version}`);
	}
	return validatedGraphStateSnapshot(migrated);
}
