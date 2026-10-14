import { assertEquals } from "jsr:@std/assert@1";
import { Logger } from "../services/logger.ts";
import { createDiagnosticLogSink } from "../services/operation_log.ts";

Deno.test("desktop logging survives denied rotation of an old startup log", () => {
	const dir = Deno.makeTempDirSync();
	const rename = Deno.renameSync;
	let rotations = 0;
	try {
		Deno.writeTextFileSync(`${dir}/diagnostics-sanitized-v1`, "");
		Deno.writeTextFileSync(`${dir}/startup.log`, "old diagnostic\n");
		const yesterday = new Date("2020-01-01");
		Deno.utimeSync(`${dir}/startup.log`, yesterday, yesterday);
		Deno.renameSync = () => {
			rotations++;
			throw new Deno.errors.PermissionDenied("startup.log is locked");
		};
		const stdout: string[] = [];
		const logger = new Logger({
			sink: createDiagnosticLogSink(dir),
			stdout: (line) => stdout.push(line),
		});
		logger.info("desktop.runtime.initialized");
		assertEquals(rotations, 1);
		assertEquals(stdout.length, 1);
		assertEquals(JSON.parse(stdout[0]).event, "desktop.runtime.initialized");
		assertEquals(Deno.readTextFileSync(`${dir}/startup.log`), "old diagnostic\n");
	} finally {
		Deno.renameSync = rename;
		Deno.removeSync(dir, { recursive: true });
	}
});
