import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	readTursoSyncConfigFromEnv,
	sanitizeSyncConfigForLog,
	type TursoSyncConfig,
	TursoSyncConfigError,
	validateTursoSyncConfig,
} from "../src/storage/turso_sync_config.ts";
import { TursoSyncEngine } from "../src/storage/turso_sync_engine.ts";
import { type TursoDatabase, TursoGraphStore } from "../src/storage/turso_store.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { persistTursoState } from "../src/storage/turso_records.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";

function createSampleSnapshot(text = "同期テスト用ローカル本文"): GraphStateSnapshot {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	const occId = crypto.randomUUID();
	return {
		works: [{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT }],
		branches: [{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: CREATED_AT }],
		workingCopies: [{ branchId, workId, text, updatedAt: CREATED_AT }],
		occurrences: [{
			id: occId,
			workId,
			parentOccurrenceId: null,
			orderKey: 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		}],
		links: [],
		systemRelations: [],
		knots: [],
		aliases: [],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [],
		resumePosition: null,
	};
}

Deno.test("validateTursoSyncConfig accepts valid sync URL and token", () => {
	const validRaw = {
		syncUrl: "https://my-db-org.turso.io",
		authToken: "valid-secret-token-12345",
	};
	const config = validateTursoSyncConfig(validRaw);
	assertEquals(config.syncUrl, "https://my-db-org.turso.io");
	assertEquals(config.authToken, "valid-secret-token-12345");
	assertEquals(config.syncIntervalMs, undefined);

	const withLibsql = validateTursoSyncConfig({
		syncUrl: "libsql://my-db.turso.io",
		authToken: "token-abc",
		syncIntervalMs: 60000,
	});
	assertEquals(withLibsql.syncUrl, "libsql://my-db.turso.io");
	assertEquals(withLibsql.syncIntervalMs, 60000);
});

Deno.test("validateTursoSyncConfig rejects invalid URLs, missing tokens, and injection attempts without leaking credentials", () => {
	const secretToken = "super-confidential-token-xyz";

	// Invalid URL scheme
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "javascript:alert(1)", authToken: secretToken }),
		TursoSyncConfigError,
	);
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "file:///etc/passwd", authToken: secretToken }),
		TursoSyncConfigError,
	);
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "ftp://example.com/db", authToken: secretToken }),
		TursoSyncConfigError,
	);

	// Missing or empty fields
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "", authToken: secretToken }),
		TursoSyncConfigError,
	);
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "https://example.com", authToken: "" }),
		TursoSyncConfigError,
	);
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "https://example.com", authToken: "   " }),
		TursoSyncConfigError,
	);

	// Invalid token characters (newline / control chars injection)
	assertThrows(
		() =>
			validateTursoSyncConfig({
				syncUrl: "https://example.com",
				authToken: "token\nwith\rnewline",
			}),
		TursoSyncConfigError,
	);

	// Non-object or invalid types
	assertThrows(() => validateTursoSyncConfig(null), TursoSyncConfigError);
	assertThrows(() => validateTursoSyncConfig("not an object"), TursoSyncConfigError);
	assertThrows(
		() => validateTursoSyncConfig({ syncUrl: "https://example.com", authToken: 12345 }),
		TursoSyncConfigError,
	);

	// Ensure error messages never contain the secret token
	try {
		validateTursoSyncConfig({ syncUrl: "not-a-valid-url", authToken: secretToken });
	} catch (error) {
		assert(error instanceof TursoSyncConfigError);
		assertEquals(error.message.includes(secretToken), false);
	}
});

Deno.test("readTursoSyncConfigFromEnv returns null by default (opt-in disabled) and parses valid env vars", () => {
	// Default: No sync env vars -> returns null
	const emptyEnv = new Map<string, string>();
	assertEquals(readTursoSyncConfigFromEnv(emptyEnv), null);

	// Partially configured env: only URL -> throws clear configuration error
	const partialEnv1 = new Map<string, string>([
		["RADIORA_TURSO_SYNC_URL", "https://my-db.turso.io"],
	]);
	assertThrows(() => readTursoSyncConfigFromEnv(partialEnv1), TursoSyncConfigError);

	// Partially configured env: only Token -> throws clear configuration error
	const partialEnv2 = new Map<string, string>([
		["RADIORA_TURSO_SYNC_TOKEN", "secret-token"],
	]);
	assertThrows(() => readTursoSyncConfigFromEnv(partialEnv2), TursoSyncConfigError);

	// Valid configuration in env
	const fullEnv = new Map<string, string>([
		["RADIORA_TURSO_SYNC_URL", "https://my-db.turso.io"],
		["RADIORA_TURSO_SYNC_TOKEN", "my-secret-token"],
		["RADIORA_TURSO_SYNC_INTERVAL_MS", "30000"],
	]);
	const config = readTursoSyncConfigFromEnv(fullEnv);
	assert(config);
	assertEquals(config.syncUrl, "https://my-db.turso.io");
	assertEquals(config.authToken, "my-secret-token");
	assertEquals(config.syncIntervalMs, 30000);
});

Deno.test("sanitizeSyncConfigForLog hides tokens and query parameters", () => {
	const config: TursoSyncConfig = {
		syncUrl: "https://user:pass@my-db.turso.io:8080/v1/sync?param=1",
		authToken: "super-secret-token-do-not-log",
		syncIntervalMs: 60000,
	};
	const sanitized = sanitizeSyncConfigForLog(config);
	assertEquals(sanitized.host, "my-db.turso.io");
	assertEquals(sanitized.protocol, "https:");
	assertEquals(sanitized.hasToken, true);
	assertEquals(sanitized.syncIntervalMs, 60000);
	assertEquals(JSON.stringify(sanitized).includes("super-secret-token-do-not-log"), false);
	assertEquals(JSON.stringify(sanitized).includes("pass"), false);
});

Deno.test("TursoGraphStore is disabled by default and preserves local-only operations", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-sync-disabled-" });
	const target = `${root}\\radiora.db`;
	const store = new TursoGraphStore(target);
	const engine = new TursoSyncEngine({ store, syncConfig: null });

	try {
		await store.initialize();
		await engine.initialize();
		assertEquals(engine.getStatus(), "disabled");

		// Local mutations work identically
		const snapshot = createSampleSnapshot();
		await store.restoreGraphState(snapshot);
		const exported = await store.exportGraphState();
		assertEquals(exported.works.length, 1);
		assertEquals(exported.workingCopies[0].text, "同期テスト用ローカル本文");

		// Sync trigger in disabled mode is a no-op and returns disabled status
		const result = await engine.sync();
		assertEquals(result.status, "disabled");

		await engine.close();
		await store.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("TursoGraphStore with opted-in sync calls push and pull directly on database instance and verifies no-op absence", async () => {
	// NOTE: External cloud credentials are not present in test environment; real network tests against live Turso Cloud are skipped.
	// This test uses connector injection to verify actual push() and pull() method invocations on the Turso database instance.
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-sync-call-" });
	const target = `${root}\\radiora.db`;

	let pushCalls = 0;
	let pullCalls = 0;

	// Create a real in-memory/file SQLite database and wrap with push/pull spy
	const { connect: connectLocal } = await import("@tursodatabase/database");
	const realDb = await connectLocal(target, { timeout: 5000 });

	const mockSyncDb: TursoDatabase = {
		exec: (sql) => realDb.exec(sql),
		get: (sql, ...args) => realDb.get(sql, ...args),
		all: (sql, ...args) => realDb.all(sql, ...args),
		transactionAsync: realDb.transactionAsync.bind(realDb),
		close: () => realDb.close(),
		push: async () => {
			pushCalls += 1;
		},
		pull: async () => {
			pullCalls += 1;
			return false; // no remote changes
		},
	};

	const syncConfig: TursoSyncConfig = {
		syncUrl: "https://my-cloud-db.turso.io",
		authToken: "test-auth-token",
	};

	const store = new TursoGraphStore(target, {
		syncConfig,
		connector: () => Promise.resolve(mockSyncDb),
	});
	const engine = new TursoSyncEngine({ store, syncConfig });

	try {
		await store.initialize();
		await engine.initialize();

		// Execute sync cycle and verify real push and pull methods were invoked (no-op absence proof)
		assertEquals(engine.getStatus(), "synced");
		assertEquals(pushCalls, 1);
		assertEquals(pullCalls, 1);

		await engine.close();
		await store.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("TursoGraphStore with opted-in sync reflects pulled remote changes into memory state via runtime validation", async () => {
	// NOTE: External cloud credentials are not present in test environment; real network tests against live Turso Cloud are skipped.
	// Verifies that when pull() returns true with new remote data written to SQLite, TursoGraphStore validates and restores memory state.
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-sync-pull-reflect-" });
	const target = `${root}\\radiora.db`;
	const remoteSnapshot = createSampleSnapshot("リモートからPullされた最新本文");

	const { connect: connectLocal } = await import("@tursodatabase/database");
	const realDb = await connectLocal(target, { timeout: 5000 });

	const mockSyncDb: TursoDatabase = {
		exec: (sql) => realDb.exec(sql),
		get: (sql, ...args) => realDb.get(sql, ...args),
		all: (sql, ...args) => realDb.all(sql, ...args),
		transactionAsync: realDb.transactionAsync.bind(realDb),
		close: () => realDb.close(),
		push: () => Promise.resolve(),
		pull: async () => {
			// Simulate pull writing remote snapshot into SQLite tables
			await persistTursoState(remoteSnapshot, mockSyncDb);
			return true; // Changes were pulled
		},
	};

	const syncConfig: TursoSyncConfig = {
		syncUrl: "https://my-cloud-db.turso.io",
		authToken: "test-auth-token",
	};

	const store = new TursoGraphStore(target, {
		syncConfig,
		connector: () => Promise.resolve(mockSyncDb),
	});

	try {
		await store.initialize();
		// Initially local is empty or different
		const initial = await store.exportGraphState();
		assertEquals(initial.workingCopies.length, 0);

		// Execute sync; pull will write remote state and store must update its memory state
		const syncResult = await store.sync();
		assertEquals(syncResult.status, "synced");

		const afterSync = await store.exportGraphState();
		assertEquals(afterSync.works.length, 1);
		assertEquals(afterSync.workingCopies[0].text, "リモートからPullされた最新本文");

		await store.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("TursoGraphStore sync push failure stays offline and preserves local data", async () => {
	// NOTE: Proves error isolation and data preservation when remote sync fails.
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-sync-failure-" });
	const target = `${root}\\radiora.db`;
	const snapshot = createSampleSnapshot();

	const { connect: connectLocal } = await import("@tursodatabase/database");
	const realDb = await connectLocal(target, { timeout: 5000 });

	let pushAttempted = false;
	const failingSyncDb: TursoDatabase = {
		exec: (sql) => realDb.exec(sql),
		get: (sql, ...args) => realDb.get(sql, ...args),
		all: (sql, ...args) => realDb.all(sql, ...args),
		transactionAsync: realDb.transactionAsync.bind(realDb),
		close: () => realDb.close(),
		push: async () => {
			pushAttempted = true;
			throw new Error("HTTP 503 Service Unavailable: Turso Cloud offline");
		},
		pull: () => Promise.resolve(false),
	};

	const syncConfig: TursoSyncConfig = {
		syncUrl: "https://my-unreachable-db.turso.io",
		authToken: "expired-token",
	};

	const store = new TursoGraphStore(target, {
		syncConfig,
		connector: () => Promise.resolve(failingSyncDb),
	});
	const engine = new TursoSyncEngine({ store, syncConfig });

	try {
		await store.initialize();
		await store.restoreGraphState(snapshot);
		await engine.initialize();

		// Trigger sync; should fail gracefully, change status to offline, and NOT return synced
		const syncResult = await engine.sync();
		assertEquals(syncResult.status, "offline");
		assertEquals(pushAttempted, true);
		assert(syncResult.status !== "synced");
		assertEquals(engine.getStatus(), "offline");

		// Local data must remain 100% intact and operational
		const exported = await store.exportGraphState();
		assertEquals(exported.works.length, 1);
		assertEquals(exported.workingCopies[0].text, "同期テスト用ローカル本文");

		// Local mutations still succeed while offline
		await store.updateWorkingCopy(
			snapshot.works[0].id,
			"ローカルオフライン編集",
			"2026-07-28T01:00:00.000Z",
		);
		const updated = await store.exportGraphState();
		assertEquals(updated.workingCopies[0].text, "ローカルオフライン編集");

		await engine.close();
		await store.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});
