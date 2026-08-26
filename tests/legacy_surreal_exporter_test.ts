import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
	exportLegacySnapshot,
	type LegacySurrealProcessHandle,
	type LegacySurrealStoreHandle,
} from "../src/storage/legacy_surreal_exporter.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";

function createDummySnapshot(): GraphStateSnapshot {
	return {
		works: [],
		branches: [],
		workingCopies: [],
		revisions: [],
		recoverySnapshots: [],
		occurrences: [],
		links: [],
		systemRelations: [],
		knots: [],
		aliases: [],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		bookmarks: [],
		resumePosition: null,
	};
}

Deno.test("exportLegacySnapshot executes full lifecycle: start -> initialize -> export -> close -> stop in strict order", async () => {
	const callSequence: string[] = [];
	const dummySnapshot = createDummySnapshot();
	const logEvents: Array<{ event: string; fields: Record<string, unknown>; cause?: unknown }> = [];

	const mockProcess: LegacySurrealProcessHandle = {
		endpoint: "http://127.0.0.1:8999",
		start: async () => {
			callSequence.push("process.start");
		},
		stop: async () => {
			callSequence.push("process.stop");
		},
	};

	const mockStore: LegacySurrealStoreHandle = {
		initialize: async () => {
			callSequence.push("store.initialize");
		},
		exportGraphState: async () => {
			callSequence.push("store.exportGraphState");
			return dummySnapshot;
		},
		close: async () => {
			callSequence.push("store.close");
		},
	};

	const result = await exportLegacySnapshot("dummy/copy/path", {
		findPort: async () => {
			callSequence.push("findPort");
			return 8999;
		},
		createProcess: (path, host, port, onLog) => {
			callSequence.push(`createProcess:${path}:${host}:${port}`);
			onLog("started", { pid: 1234 });
			return mockProcess;
		},
		createStore: async (endpoint) => {
			callSequence.push(`createStore:${endpoint}`);
			return mockStore;
		},
		onLog: (event, fields, cause) => {
			logEvents.push({ event, fields, cause });
		},
	});

	assertEquals(result, dummySnapshot);
	assertEquals(callSequence, [
		"findPort",
		"createProcess:dummy/copy/path:127.0.0.1:8999",
		"process.start",
		"createStore:http://127.0.0.1:8999",
		"store.initialize",
		"store.exportGraphState",
		"store.close",
		"process.stop",
	]);
	assertEquals(logEvents.length, 1);
	assertEquals(logEvents[0].event, "surrealdb.migration.event");
});

Deno.test("exportLegacySnapshot guarantees store.close and process.stop on export failure and preserves error", async () => {
	const callSequence: string[] = [];
	const exportError = new Error("Surreal query timeout during export");

	const mockProcess: LegacySurrealProcessHandle = {
		endpoint: "http://127.0.0.1:8999",
		start: async () => {
			callSequence.push("process.start");
		},
		stop: async () => {
			callSequence.push("process.stop");
		},
	};

	const mockStore: LegacySurrealStoreHandle = {
		initialize: async () => {
			callSequence.push("store.initialize");
		},
		exportGraphState: async () => {
			callSequence.push("store.exportGraphState");
			throw exportError;
		},
		close: async () => {
			callSequence.push("store.close");
		},
	};

	await assertRejects(
		() =>
			exportLegacySnapshot("dummy/copy/path", {
				findPort: async () => 8999,
				createProcess: () => mockProcess,
				createStore: async () => mockStore,
			}),
		Error,
		"Surreal query timeout during export",
	);

	assertEquals(callSequence, [
		"process.start",
		"store.initialize",
		"store.exportGraphState",
		"store.close",
		"process.stop",
	]);
});

Deno.test("exportLegacySnapshot guarantees process.stop and reports to onLog when store.close fails", async () => {
	const callSequence: string[] = [];
	const closeError = new Error("Database socket already closed");
	const logEvents: Array<{ event: string; fields: Record<string, unknown>; cause?: unknown }> = [];

	const mockProcess: LegacySurrealProcessHandle = {
		endpoint: "http://127.0.0.1:8999",
		start: async () => {
			callSequence.push("process.start");
		},
		stop: async () => {
			callSequence.push("process.stop");
		},
	};

	const mockStore: LegacySurrealStoreHandle = {
		initialize: async () => {
			callSequence.push("store.initialize");
		},
		exportGraphState: async () => {
			callSequence.push("store.exportGraphState");
			return createDummySnapshot();
		},
		close: async () => {
			callSequence.push("store.close");
			throw closeError;
		},
	};

	const result = await exportLegacySnapshot("dummy/copy/path", {
		findPort: async () => 8999,
		createProcess: () => mockProcess,
		createStore: async () => mockStore,
		onLog: (event, fields, cause) => {
			logEvents.push({ event, fields, cause });
		},
	});

	assert(result);
	assertEquals(callSequence, [
		"process.start",
		"store.initialize",
		"store.exportGraphState",
		"store.close",
		"process.stop",
	]);
	const closeFailedLog = logEvents.find((e) =>
		e.event === "surrealdb.migration_store.close.failed"
	);
	assert(closeFailedLog);
	assertEquals(closeFailedLog.cause, closeError);
});
