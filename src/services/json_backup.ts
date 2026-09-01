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
	migrateBackupV6,
	type StoredGraphV1,
	type StoredGraphV2,
	type StoredGraphV3,
	type StoredGraphV4,
	type StoredGraphV5,
	type StoredGraphV6,
	type StoredGraphV7,
} from "../storage/backup_migrations.ts";

export const CURRENT_BACKUP_SCHEMA_VERSION = 7;
export const CURRENT_STORAGE_SCHEMA_VERSION = 7;

export interface JsonBackupV6 {
	format: "radiora-backup";
	schemaVersion: 6;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 6 };
	data: GraphStateSnapshot;
}

export interface JsonBackupV7 {
	format: "radiora-backup";
	schemaVersion: 7;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 7 };
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
		const backup: JsonBackupV7 = {
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
		} catch (cause) {
			throw new Error("バックアップJSONを解析できません。", { cause });
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
		if (!isLegacyBackupV0(envelope)) {
			throw new Error("旧形式のバックアップ構造が不正です。");
		}
		return validatedGraphStateSnapshot(migrateBackupV6(
			migrateBackupV5(
				migrateBackupV4(
					migrateBackupV3(
						migrateBackupV2(
							migrateBackupV1(migrateBackupV0(envelope)),
						),
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
	let migrated: StoredGraphV7;
	switch (version) {
		case 1:
			migrated = migrateBackupV6(
				migrateBackupV5(
					migrateBackupV4(
						migrateBackupV3(
							migrateBackupV2(migrateBackupV1(data as StoredGraphV1)),
						),
					),
				),
			);
			break;
		case 2:
			migrated = migrateBackupV6(
				migrateBackupV5(
					migrateBackupV4(migrateBackupV3(migrateBackupV2(data as StoredGraphV2))),
				),
			);
			break;
		case 3:
			migrated = migrateBackupV6(
				migrateBackupV5(
					migrateBackupV4(migrateBackupV3(data as StoredGraphV3)),
				),
			);
			break;
		case 4:
			migrated = migrateBackupV6(migrateBackupV5(migrateBackupV4(data as StoredGraphV4)));
			break;
		case 5:
			migrated = migrateBackupV6(migrateBackupV5(data as StoredGraphV5));
			break;
		case 6:
			migrated = migrateBackupV6(data as StoredGraphV6);
			break;
		case 7:
			if (!isRecord(data) || !Object.hasOwn(data, "relationTypeDefinitions")) {
				throw new Error("バックアップデータに relationTypeDefinitions が必要です。");
			}
			return validatedGraphStateSnapshot(data);
		default:
			throw new Error(`未対応のbackup schema versionです: ${version}`);
	}
	return validatedGraphStateSnapshot(migrated);
}

function isLegacyBackupV0(
	value: Record<string, unknown>,
): value is Record<string, unknown> & BackupV0 {
	return Array.isArray(value.items) && Array.isArray(value.links) && Array.isArray(value.knots) &&
		(value.aliases === undefined || Array.isArray(value.aliases)) &&
		(value.emergenceFeedback === undefined || isRecord(value.emergenceFeedback)) &&
		(value.savedRuleQueries === undefined || Array.isArray(value.savedRuleQueries));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
