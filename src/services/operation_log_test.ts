import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { DiagnosticLogFiles, OperationLog } from "./operation_log.ts";

Deno.test("OperationLog records safe events, summarizes, exports, and clears both logs", () => {
	const dir = Deno.makeTempDirSync();
	try {
		const log = new OperationLog(dir);
		log.record("work.create", "ok", 12.345);
		log.record("work.create", "error", 5, "TypeError");
		log.record("work.create", "error", 1, "private search query");
		const exported = log.exportJsonl();
		const records = exported.trim().split("\n").map((line) => JSON.parse(line));
		assertEquals(records.length, 3);
		assertEquals(
			Object.keys(records[0]).sort(),
			["durationMs", "event", "outcome", "sessionId", "timestamp"].sort(),
		);
		assertEquals(records[0].durationMs, 12.35);
		assertEquals(records[0].sessionId, records[1].sessionId);
		assertEquals(records[2].errorType, "OtherError");
		assertEquals(log.summary().failed, 2);
		assertEquals(log.summary().byEvent, [{ event: "work.create", count: 3 }]);
		const diagnostics = new DiagnosticLogFiles(dir);
		diagnostics.write("safe diagnostic");
		assertExists(Deno.statSync(`${dir}/startup.log`));
		log.clearAll();
		assertEquals(log.exportJsonl(), "");
		assertEquals([...Deno.readDirSync(dir)].map((entry) => entry.name), [
			"diagnostics-sanitized-v1",
		]);
	} finally {
		Deno.removeSync(dir, { recursive: true });
	}
});

Deno.test("DiagnosticLogFiles discards legacy logs that may contain private text", () => {
	const dir = Deno.makeTempDirSync();
	try {
		Deno.writeTextFileSync(`${dir}/startup.log`, "private item text");
		const diagnostics = new DiagnosticLogFiles(dir);
		assertEquals([...Deno.readDirSync(dir)].map((entry) => entry.name), [
			"diagnostics-sanitized-v1",
		]);
		diagnostics.write("safe diagnostic");
		assertEquals(Deno.readTextFileSync(`${dir}/startup.log`), "safe diagnostic\n");
	} finally {
		Deno.removeSync(dir, { recursive: true });
	}
});

Deno.test("DiagnosticLogFiles expires older sanitized files", () => {
	const dir = Deno.makeTempDirSync();
	try {
		Deno.writeTextFileSync(`${dir}/diagnostics-sanitized-v1`, "");
		const old = `${dir}/startup-2020-01-01.log`;
		Deno.writeTextFileSync(old, "old diagnostic\n");
		Deno.utimeSync(old, new Date("2020-01-01"), new Date("2020-01-01"));
		new DiagnosticLogFiles(dir);
		assertEquals([...Deno.readDirSync(dir)].map((entry) => entry.name), [
			"diagnostics-sanitized-v1",
		]);
	} finally {
		Deno.removeSync(dir, { recursive: true });
	}
});

Deno.test("OperationLog removes expired and oldest over-capacity files", () => {
	const dir = Deno.makeTempDirSync();
	try {
		const old = `${dir}/operation-2020-01-01.jsonl`;
		Deno.writeTextFileSync(old, "old\n");
		Deno.utimeSync(old, new Date("2020-01-01"), new Date("2020-01-01"));
		const log = new OperationLog(dir);
		assertEquals([...Deno.readDirSync(dir)].length, 0);
		const day = new Date().toISOString().slice(0, 10);
		for (let index = 0; index < 4; index++) {
			Deno.writeTextFileSync(`${dir}/operation-${day}-${index}.jsonl`, "x".repeat(6 * 1024 * 1024));
		}
		log.record("work.create", "ok");
		const total = [...Deno.readDirSync(dir)].reduce(
			(sum, entry) => sum + Deno.statSync(`${dir}/${entry.name}`).size,
			0,
		);
		assertEquals(total <= 20 * 1024 * 1024, true);
	} finally {
		Deno.removeSync(dir, { recursive: true });
	}
});
