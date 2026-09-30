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
} from "./backup_migrations.ts";
import { type GraphStateSnapshot, validatedGraphStateSnapshot } from "./graph_store.ts";

const SCHEMA_VERSION = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 } as const;

export interface DecodedJsonGraph {
	data: GraphStateSnapshot;
	/** Original version to protect before rewriting; current inputs need no rewrite. */
	protectionVersion: number | null;
}

/** Decode storage input without I/O, preserving the store's migration and validation order. */
export function decodeJsonGraph(input: unknown): DecodedJsonGraph {
	// Keep the legacy `in` check: primitive/null inputs retain their native TypeError.
	const versioned = "schemaVersion" in (input as object);
	const source = input as Record<string, unknown>;
	const version = versioned ? source.schemaVersion : 0;
	const migrated = versioned ? readVersioned(source) : migrateBackupV6(
		migrateBackupV5(
			migrateBackupV4(
				migrateBackupV3(
					migrateBackupV2(migrateBackupV1(migrateBackupV0(input as BackupV0))),
				),
			),
		),
	);
	return {
		data: validatedGraphStateSnapshot(migrated),
		protectionVersion: typeof version === "number" && version < SCHEMA_VERSION.v8 ? version : null,
	};
}

function readVersioned(parsed: Record<string, unknown>): unknown {
	if (parsed.format !== "radiora-backup") {
		throw new Error(`Unsupported backup format: ${String(parsed.format)}`);
	}
	// Migration assertions describe the historical shape, not trusted input.
	// The complete migrated graph is runtime-validated before leaving the codec.
	const data = parsed.data;
	switch (parsed.schemaVersion) {
		case SCHEMA_VERSION.v1:
			return migrateBackupV6(
				migrateBackupV5(
					migrateBackupV4(
						migrateBackupV3(migrateBackupV2(migrateBackupV1(data as StoredGraphV1))),
					),
				),
			);
		case SCHEMA_VERSION.v2:
			return migrateBackupV6(
				migrateBackupV5(migrateBackupV4(migrateBackupV3(migrateBackupV2(data as StoredGraphV2)))),
			);
		case SCHEMA_VERSION.v3:
			return migrateBackupV6(
				migrateBackupV5(migrateBackupV4(migrateBackupV3(data as StoredGraphV3))),
			);
		case SCHEMA_VERSION.v4:
			return migrateBackupV6(migrateBackupV5(migrateBackupV4(data as StoredGraphV4)));
		case SCHEMA_VERSION.v5:
			return migrateBackupV6(migrateBackupV5(data as StoredGraphV5));
		case SCHEMA_VERSION.v6:
			return migrateBackupV6(data as StoredGraphV6);
		case SCHEMA_VERSION.v7:
		case SCHEMA_VERSION.v8:
			if (
				typeof data !== "object" || data === null || Array.isArray(data) ||
				!("relationTypeDefinitions" in data)
			) {
				throw new Error("Invalid V7 backup data: missing relationTypeDefinitions");
			}
			return data;
		default:
			throw new Error(`Unsupported backup schema version: ${String(parsed.schemaVersion)}`);
	}
}
