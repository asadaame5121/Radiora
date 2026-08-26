// Deno FFI Harness & Test for Syncular Rust Core (C-ABI)
//
// Proves Deno.dlopen symbol export and exercises full Syncular lifecycle:
// 1. Library loading and symbol bindings
// 2. Client lifecycle (new, create with schema, local file SQLite)
// 3. Table subscription, mutation (upsert), query, readRows
// 4. Outbox tracking (pendingCommitIds) and event polling (change batches, sync intents)
// 5. Error handling and clean resource teardown

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

const isWindows = Deno.build.os === "windows";
const dllPath = new URL(
	isWindows
		? "./target/release/syncular_rust_ffi_spike.dll"
		: "./target/release/libsyncular_rust_ffi_spike.so",
	import.meta.url,
).pathname.slice(isWindows ? 1 : 0).replaceAll("/", "\\");

export function openSyncularLib() {
	return Deno.dlopen(dllPath, {
		syncular_client_new: {
			parameters: ["buffer"],
			result: "pointer",
		},
		syncular_client_command: {
			parameters: ["pointer", "buffer"],
			result: "pointer",
		},
		syncular_client_poll_event: {
			parameters: ["pointer", "i64"],
			result: "pointer",
		},
		syncular_client_close: {
			parameters: ["pointer"],
			result: "void",
		},
		syncular_free_string: {
			parameters: ["pointer"],
			result: "void",
		},
	});
}

export type SyncularLib = ReturnType<typeof openSyncularLib>;

const encoder = new TextEncoder();

function toCString(str: string): Uint8Array {
	return encoder.encode(`${str}\0`);
}

function fromCStringAndFree(lib: SyncularLib, ptr: Deno.PointerValue): string | null {
	if (ptr === null) return null;
	try {
		const view = new Deno.UnsafePointerView(ptr);
		return view.getCString();
	} finally {
		lib.symbols.syncular_free_string(ptr);
	}
}

export interface CommandResult {
	result?: Record<string, unknown>;
	error?: { code: string; message: string };
}

// ---- Runtime Type Guards & Validation Helpers (AGENTS.md trust boundary) ----

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`Expected object record for ${context}, got: ${typeof value}`);
	}
	return value;
}

function parseJsonRecord(text: string, context: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(text);
	return asRecord(parsed, context);
}

function parseCommandResult(text: string): CommandResult {
	const record = parseJsonRecord(text, "command result");
	const result = isRecord(record.result) ? record.result : undefined;
	let error: { code: string; message: string } | undefined;
	if (isRecord(record.error)) {
		const code = typeof record.error.code === "string" ? record.error.code : "unknown";
		const message = typeof record.error.message === "string" ? record.error.message : "";
		error = { code, message };
	}
	return { result, error };
}

function requireArray(value: unknown, context: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`Expected array for ${context}, got: ${typeof value}`);
	}
	return value;
}

function requireString(value: unknown, context: string): string {
	if (typeof value !== "string") {
		throw new Error(`Expected string for ${context}, got: ${typeof value}`);
	}
	return value;
}

export class SyncularFfiClient {
	private handle: Deno.PointerValue;
	private lib: SyncularLib;

	constructor(lib: SyncularLib, config: Record<string, unknown> = {}) {
		this.lib = lib;
		const configJson = JSON.stringify(config);
		this.handle = this.lib.symbols.syncular_client_new(toCString(configJson));
		if (this.handle === null) {
			throw new Error("Failed to create Syncular client handle (null returned)");
		}
	}

	command(method: string, params: unknown = null): CommandResult {
		if (this.handle === null) throw new Error("Client handle is closed");
		const payload = JSON.stringify({ method, params });
		const replyPtr = this.lib.symbols.syncular_client_command(this.handle, toCString(payload));
		if (replyPtr === null) {
			throw new Error(`syncular_client_command returned null for method ${method}`);
		}
		const replyText = fromCStringAndFree(this.lib, replyPtr);
		if (!replyText) throw new Error("Empty response string from syncular_client_command");
		return parseCommandResult(replyText);
	}

	pollEvent(timeoutMs = 0): Record<string, unknown> | null {
		if (this.handle === null) return null;
		const eventPtr = this.lib.symbols.syncular_client_poll_event(this.handle, BigInt(timeoutMs));
		if (eventPtr === null) return null;
		const eventText = fromCStringAndFree(this.lib, eventPtr);
		return eventText ? parseJsonRecord(eventText, "polled event") : null;
	}

	close(): void {
		if (this.handle !== null) {
			const ptr = this.handle;
			this.handle = null;
			this.lib.symbols.syncular_client_close(ptr);
		}
	}
}

// ---- Full Lifecycle Verification Test ----

Deno.test("Syncular Deno FFI full lifecycle verification (new -> create -> mutate -> query/readRows -> pendingCommitIds -> poll/free -> close)", async () => {
	console.log(`[Harness] Loading Syncular FFI DLL: ${dllPath}`);
	const lib = openSyncularLib();

	const tempDir = await Deno.makeTempDir({ prefix: "radiora-syncular-spike-" });
	const dbPath = `${tempDir}\\radiora_syncular.db`;
	console.log(`[Harness] Temp SQLite Path: ${dbPath}`);

	const client = new SyncularFfiClient(lib, {});

	try {
		// 1. Schema definition matching Radiora domain
		const schema = {
			version: 1,
			tables: [
				{
					name: "works",
					primaryKey: "id",
					columns: [
						{ name: "id", type: "string", nullable: false },
						{ name: "text", type: "string", nullable: false },
						{ name: "updated_at", type: "string", nullable: false },
						{ name: "is_pinned", type: "boolean", nullable: false },
					],
					scopes: [],
				},
			],
		};

		// 2. create: open local SQLite & initialize schema
		const createRes = client.command("create", {
			clientId: "deno_spike_client_1",
			schema,
			dbPath,
		});
		assertEquals(createRes.error, undefined, `create failed: ${JSON.stringify(createRes.error)}`);
		assertEquals(createRes.result, {});

		// 3. subscribe to table
		const subRes = client.command("subscribe", {
			id: "sub_works_all",
			table: "works",
			scopes: {},
		});
		assertEquals(subRes.error, undefined, `subscribe failed: ${JSON.stringify(subRes.error)}`);

		// 4. mutate: 1 optimistic upsert
		const mutateRes = client.command("mutate", {
			mutations: [
				{
					op: "upsert",
					table: "works",
					values: {
						id: "work_spike_42",
						text: "Syncular Deno FFI Integration Spike Note",
						updated_at: "2026-08-26T19:35:00.000Z",
						is_pinned: true,
					},
				},
			],
		});
		assertEquals(mutateRes.error, undefined, `mutate failed: ${JSON.stringify(mutateRes.error)}`);
		const mutateResult = asRecord(mutateRes.result, "mutate result");
		const clientCommitId = requireString(mutateResult.clientCommitId, "clientCommitId");
		assertNotEquals(clientCommitId, "");

		// 5. readRows: check optimistic row
		const readRes = client.command("readRows", { table: "works" });
		const readResult = asRecord(readRes.result, "readRows result");
		const rawRows = requireArray(readResult.rows, "readRows.rows");
		assertEquals(rawRows.length, 1);
		const firstRow = asRecord(rawRows[0], "first row");
		const rowValues = asRecord(firstRow.values, "row values");
		assertEquals(rowValues.id, "work_spike_42");
		assertEquals(rowValues.text, "Syncular Deno FFI Integration Spike Note");
		assertEquals(rowValues.is_pinned, true);

		// 6. query: execute raw SQL query
		const queryRes = client.command("query", {
			sql: "SELECT id, text, is_pinned FROM works WHERE id = ?",
			params: ["work_spike_42"],
		});
		const queryResult = asRecord(queryRes.result, "query result");
		const queryRows = requireArray(queryResult.rows, "query.rows");
		assertEquals(queryRows.length, 1);
		const queryRow = asRecord(queryRows[0], "queryRow");
		assertEquals(queryRow.text, "Syncular Deno FFI Integration Spike Note");

		// 7. pendingCommitIds: check outbox
		const pendingRes = client.command("pendingCommitIds", null);
		const pendingResult = asRecord(pendingRes.result, "pendingCommitIds result");
		const pendingIds = requireArray(pendingResult.ids, "pendingCommitIds.ids").map((id) =>
			requireString(id, "pending id")
		);
		assertEquals(pendingIds.length, 1);
		assertEquals(pendingIds[0], clientCommitId);

		// 8. poll/free: drain events (change batch & sync intent)
		const events: Array<Record<string, unknown>> = [];
		let event: Record<string, unknown> | null;
		while ((event = client.pollEvent(0)) !== null) {
			events.push(event);
		}
		const changeEvent = events.find((e) => e.type === "change");
		assert(changeEvent !== undefined, "Expected 'change' event");
		const intentEvent = events.find((e) => e.type === "sync-intent");
		assert(intentEvent !== undefined, "Expected 'sync-intent' event");

		// 9. error boundary: test invalid SQL without panic
		const errorRes = client.command("query", {
			sql: "SELECT * FROM non_existent_table",
			params: [],
		});
		assert(errorRes.error !== undefined, "Expected error on invalid table query");
		assertEquals(errorRes.error?.code, "client.failed");
	} finally {
		// 10. close: clean handle destruction
		client.close();

		// Verify database file exists and is accessible
		const fileInfo = await Deno.stat(dbPath);
		assert(fileInfo.size > 0, "SQLite file must have non-zero size");

		await Deno.remove(tempDir, { recursive: true });
	}

	// 11. DLL unload
	lib.close();
});
