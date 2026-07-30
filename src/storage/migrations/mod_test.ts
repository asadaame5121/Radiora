import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { revisionSnapshotMigration } from "./0002_revision_snapshot.ts";
import { bookmarkResumeMigration } from "./0003_bookmark_resume.ts";
import { stubStateMigration } from "./0004_stub_state.ts";
import { mergeProvenanceMigration } from "./0005_merge_provenance.ts";
import { emergenceSuggestionMigration } from "./0006_emergence_suggestion.ts";
import {
	type MigrationContext,
	type MigrationJournalEntry,
	type MigrationStateStore,
	runStorageMigrations,
	type SchemaMetadata,
	type StorageMigration,
} from "./mod.ts";

class MemoryMigrationState implements MigrationStateStore {
	metadata: SchemaMetadata | null = null;
	journal: MigrationJournalEntry[] = [];

	readMetadata(): Promise<SchemaMetadata | null> {
		return Promise.resolve(this.metadata);
	}

	writeMetadata(metadata: SchemaMetadata): Promise<void> {
		this.metadata = metadata;
		return Promise.resolve();
	}

	writeJournal(entry: MigrationJournalEntry): Promise<void> {
		this.journal.push(entry);
		return Promise.resolve();
	}
}

const context: MigrationContext = {
	execute: () => Promise.resolve(undefined),
};

Deno.test("version 0 remains unversioned until the first formal migration", async () => {
	const state = new MemoryMigrationState();

	assertEquals(
		await runStorageMigrations({
			state,
			context,
			migrations: [],
			appVersion: "test",
			targetVersion: 0,
		}),
		0,
	);
	assertEquals(state.metadata, null);
	assertEquals(state.journal, []);
});

Deno.test("migration advances metadata only after validation", async () => {
	const state = new MemoryMigrationState();
	const calls: string[] = [];
	const migration: StorageMigration = {
		id: "0001_test",
		fromVersion: 0,
		toVersion: 1,
		up: () => {
			calls.push("up");
			return Promise.resolve();
		},
		validate: () => {
			calls.push("validate");
			return Promise.resolve();
		},
	};
	const timestamps = [
		"2026-07-27T00:00:00.000Z",
		"2026-07-27T00:00:01.000Z",
	];

	assertEquals(
		await runStorageMigrations({
			state,
			context,
			migrations: [migration],
			appVersion: "0.1.0",
			targetVersion: 1,
			now: () => timestamps.shift()!,
		}),
		1,
	);
	assertEquals(calls, ["up", "validate"]);
	assertEquals(state.metadata?.version, 1);
	assertEquals(state.journal.map((entry) => entry.status), ["started", "completed"]);
});

Deno.test("failed validation records failure without advancing metadata", async () => {
	const state = new MemoryMigrationState();
	const migration: StorageMigration = {
		id: "0001_invalid",
		fromVersion: 0,
		toVersion: 1,
		up: () => Promise.resolve(),
		validate: () => Promise.reject(new Error("invariant failed")),
	};

	await assertRejects(
		() =>
			runStorageMigrations({
				state,
				context,
				migrations: [migration],
				appVersion: "test",
				targetVersion: 1,
			}),
		Error,
		"invariant failed",
	);
	assertEquals(state.metadata, null);
	assertEquals(state.journal.at(-1)?.status, "failed");
	assertEquals(state.journal.at(-1)?.error, "invariant failed");
});

Deno.test("newer storage schema is rejected before writing", async () => {
	const state = new MemoryMigrationState();
	state.metadata = {
		id: "radiora",
		version: 2,
		updatedAt: "2026-07-27T00:00:00.000Z",
		lastMigrationId: "0002_future",
		appVersion: "future",
	};

	await assertRejects(
		() =>
			runStorageMigrations({
				state,
				context,
				migrations: [],
				appVersion: "test",
				targetVersion: 1,
			}),
		Error,
		"newer than supported",
	);
	assertEquals(state.journal, []);
});

Deno.test("version 1 storage expands to revision and snapshot schema version 2", async () => {
	const state = new MemoryMigrationState();
	state.metadata = {
		id: "radiora",
		version: 1,
		updatedAt: "2026-07-27T00:00:00.000Z",
		lastMigrationId: "0001_work_occurrence",
		appVersion: "0.1.0",
	};
	const statements: string[] = [];

	assertEquals(
		await runStorageMigrations({
			state,
			context: {
				execute: (statement) => {
					statements.push(statement);
					return Promise.resolve(undefined);
				},
			},
			migrations: [revisionSnapshotMigration],
			appVersion: "0.1.0",
			targetVersion: 2,
		}),
		2,
	);
	assertEquals(state.metadata.version, 2);
	assertEquals(state.metadata.lastMigrationId, "0002_revision_snapshot");
	assertStringIncludes(statements[0], "DEFINE TABLE IF NOT EXISTS recovery_snapshot");
	assertStringIncludes(statements[0], "source_revision");
	assertStringIncludes(statements[1], "INFO FOR TABLE recovery_snapshot");
});

Deno.test("version 2 storage expands to bookmark and resume schema version 3", async () => {
	const state = new MemoryMigrationState();
	state.metadata = {
		id: "radiora",
		version: 2,
		updatedAt: "2026-07-28T00:00:00.000Z",
		lastMigrationId: "0002_revision_snapshot",
		appVersion: "0.1.0",
	};
	const statements: string[] = [];

	assertEquals(
		await runStorageMigrations({
			state,
			context: {
				execute: (statement) => {
					statements.push(statement);
					return Promise.resolve(undefined);
				},
			},
			migrations: [bookmarkResumeMigration],
			appVersion: "0.1.0",
			targetVersion: 3,
		}),
		3,
	);
	assertEquals(state.metadata.version, 3);
	assertEquals(state.metadata.lastMigrationId, "0003_bookmark_resume");
	assertStringIncludes(statements[0], "DEFINE TABLE IF NOT EXISTS bookmark");
	assertStringIncludes(statements[0], "DEFINE TABLE IF NOT EXISTS resume_position");
	assertStringIncludes(statements[1], "INFO FOR TABLE bookmark");
});

Deno.test("version 3 storage expands to stub state schema version 4", async () => {
	const state = new MemoryMigrationState();
	state.metadata = {
		id: "radiora",
		version: 3,
		updatedAt: "2026-07-30T00:00:00.000Z",
		lastMigrationId: "0003_bookmark_resume",
		appVersion: "0.1.0",
	};
	const statements: string[] = [];

	assertEquals(
		await runStorageMigrations({
			state,
			context: {
				execute: (statement) => {
					statements.push(statement);
					return Promise.resolve(undefined);
				},
			},
			migrations: [stubStateMigration],
			appVersion: "0.1.0",
			targetVersion: 4,
		}),
		4,
	);
	assertEquals(state.metadata.version, 4);
	assertEquals(state.metadata.lastMigrationId, "0004_stub_state");
	assertStringIncludes(statements[0], "DEFINE FIELD IF NOT EXISTS stub ON work");
	assertStringIncludes(statements[0], "DEFINE FIELD IF NOT EXISTS stub.created_at ON work");
	assertStringIncludes(statements[0], "DEFINE FIELD IF NOT EXISTS stub.created_via ON work");
	assertStringIncludes(statements[0], "DEFINE FIELD IF NOT EXISTS stub.context ON work");
	assertStringIncludes(statements[1], "INFO FOR TABLE work");
});

Deno.test("version 4 storage expands to merge provenance schema version 5", async () => {
	const state = new MemoryMigrationState();
	state.metadata = {
		id: "radiora",
		version: 4,
		updatedAt: "2026-07-30T00:00:00.000Z",
		lastMigrationId: "0004_stub_state",
		appVersion: "0.1.0",
	};
	const statements: string[] = [];
	assertEquals(
		await runStorageMigrations({
			state,
			context: {
				execute: (statement) => {
					statements.push(statement);
					return Promise.resolve(undefined);
				},
			},
			migrations: [mergeProvenanceMigration],
			appVersion: "0.1.0",
			targetVersion: 5,
		}),
		5,
	);
	assertEquals(state.metadata.lastMigrationId, "0005_merge_provenance");
	assertStringIncludes(statements[0], "merged_into_work");
	assertStringIncludes(statements[0], "merged_at");
	assertStringIncludes(statements[1], "INFO FOR TABLE work");
});

Deno.test("version 5 storage expands to persistent emergence suggestions schema version 6", async () => {
	const state = new MemoryMigrationState();
	state.metadata = {
		id: "radiora",
		version: 5,
		updatedAt: "2026-07-30T00:00:00.000Z",
		lastMigrationId: "0005_merge_provenance",
		appVersion: "0.1.0",
	};
	const statements: string[] = [];
	assertEquals(
		await runStorageMigrations({
			state,
			context: {
				execute: (statement) => {
					statements.push(statement);
					return Promise.resolve(undefined);
				},
			},
			migrations: [emergenceSuggestionMigration],
			appVersion: "0.1.0",
			targetVersion: 6,
		}),
		6,
	);
	assertEquals(state.metadata.lastMigrationId, "0006_emergence_suggestion");
	assertStringIncludes(statements[0], "DEFINE TABLE IF NOT EXISTS emergence_suggestion");
	assertStringIncludes(statements[0], "context_work");
	assertStringIncludes(statements[0], "status");
	assertStringIncludes(statements[1], "INFO FOR TABLE emergence_suggestion");
	assertStringIncludes(statements[1], "score < 0 OR score > 1");
	assertStringIncludes(statements[1], 'status = "dismissed"');
	assertStringIncludes(statements[1], "THROW");
});
