import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Logger, selectLogRecord } from "./logger.ts";

function testLogger(monotonicValues: number[] = [10, 10]): { logger: Logger; lines: string[] } {
	const lines: string[] = [];
	let monotonicIndex = 0;
	return {
		logger: new Logger({
			sink: (line) => lines.push(line),
			stdout: () => {},
			now: () => "2026-08-07T00:00:00.000Z",
			monotonicNow: () => monotonicValues[monotonicIndex++] ?? monotonicValues.at(-1) ?? 0,
		}),
		lines,
	};
}

Deno.test("logger writes structured JSONL records", () => {
	const { logger, lines } = testLogger();
	logger.info("workspace.loaded", { nodes: 1823 });

	assertEquals(JSON.parse(lines[0]), {
		timestamp: "2026-08-07T00:00:00.000Z",
		level: "info",
		event: "workspace.loaded",
		nodes: 1823,
	});
});

Deno.test("release logs only selected operations and diagnostics", () => {
	const entry = { timestamp: "2026-09-23T00:00:00Z", level: "info" as const, event: "rpc.request" };
	assertEquals(selectLogRecord("development", { ...entry, method: "listOutline" }), {
		...entry,
		method: "listOutline",
	});
	assertEquals(selectLogRecord("release", { ...entry, method: "listOutline" }), null);
	assertEquals(
		selectLogRecord("release", { ...entry, method: "createItem", privateText: "secret" }),
		{
			...entry,
			method: "createItem",
		},
	);
	assertEquals(
		selectLogRecord("release", { ...entry, event: "renderer.log", message: "text" }),
		null,
	);
	assertEquals(selectLogRecord("release", { ...entry, level: "error" }), {
		...entry,
		level: "error",
	});
});

Deno.test("release errors keep their type without user text", () => {
	const lines: string[] = [];
	const logger = new Logger({
		sink: (line) => lines.push(line),
		selectRecord: (entry) => selectLogRecord("release", entry),
		now: () => "2026-09-23T00:00:00Z",
	});
	logger.error("rpc.request", new Error("private search query"), { method: "searchItems" });
	assertEquals(JSON.parse(lines[0]), {
		timestamp: "2026-09-23T00:00:00Z",
		level: "error",
		event: "rpc.request",
		method: "searchItems",
		error: { name: "Error" },
	});
});

Deno.test("development diagnostics omit user supplied fields and error messages", () => {
	const record = selectLogRecord("development", {
		timestamp: "2026-09-23T00:00:00Z",
		level: "error",
		event: "rpc.request",
		method: "searchItems",
		query: "private search query",
		error: { name: "Error", message: "private search query" },
	});
	assertEquals(record, {
		timestamp: "2026-09-23T00:00:00Z",
		level: "error",
		event: "rpc.request",
		method: "searchItems",
		error: { name: "Error" },
	});
});

Deno.test("logger timed records duration and preserves the result", async () => {
	const { logger, lines } = testLogger([100, 142.345]);
	const result = await logger.timed("search.completed", async () => "ok", { hits: 24 });

	assertEquals(result, "ok");
	assertEquals(JSON.parse(lines[0]), {
		timestamp: "2026-08-07T00:00:00.000Z",
		level: "info",
		event: "search.completed",
		hits: 24,
		durationMs: 42.35,
		outcome: "ok",
	});
});

Deno.test("logger timed records failures and rethrows them", async () => {
	const { logger, lines } = testLogger([4, 9]);
	const cause = new Error("database unavailable");

	await assertRejects(
		() =>
			logger.timed("workspace.load", async () => {
				throw cause;
			}),
		Error,
		"database unavailable",
	);

	const record = JSON.parse(lines[0]);
	assertEquals(record.level, "error");
	assertEquals(record.event, "workspace.load");
	assertEquals(record.durationMs, 5);
	assertEquals(record.outcome, "error");
	assertEquals(record.error.message, "database unavailable");
});
