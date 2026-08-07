import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { findSurrealCommand, surrealCommandCandidates } from "./surreal_process.ts";
import {
	powerShellRecoverListenerScript,
	powerShellStartScript,
	powerShellStopScript,
} from "./windows_hidden_process.ts";

const sep = Deno.build.os === "windows" ? "\\" : "/";

Deno.test("surrealCommandCandidates: bundle directory is searched first", () => {
	const candidates = surrealCommandCandidates(
		`C:${sep}apps${sep}radiora`,
		`C:${sep}Users${sep}taro`,
	);
	assertEquals(candidates, [
		`C:${sep}apps${sep}radiora${sep}surreal.exe`,
		"surreal",
		`C:${sep}Users${sep}taro${sep}.surrealdb${sep}surreal.exe`,
	]);
});

Deno.test("surrealCommandCandidates: omits empty locations", () => {
	assertEquals(surrealCommandCandidates(null, null), ["surreal"]);
	assertEquals(surrealCommandCandidates(`C:${sep}apps${sep}radiora`, null), [
		`C:${sep}apps${sep}radiora${sep}surreal.exe`,
		"surreal",
	]);
	assertEquals(surrealCommandCandidates(null, `C:${sep}Users${sep}taro`), [
		"surreal",
		`C:${sep}Users${sep}taro${sep}.surrealdb${sep}surreal.exe`,
	]);
});

Deno.test("findSurrealCommand: prefers the bundled executable", async () => {
	const candidates = ["bundle/surreal.exe", "surreal", "profile/surreal.exe"];
	const probed: string[] = [];
	const command = await findSurrealCommand(candidates, async (candidate) => {
		probed.push(candidate);
		return candidate === candidates[0];
	});
	assertEquals(command, candidates[0]);
	assertEquals(probed, [candidates[0]]);
});

Deno.test("findSurrealCommand: skips candidates that fail the version probe", async () => {
	const candidates = ["bundle/surreal.exe", "surreal", "profile/surreal.exe"];
	const command = await findSurrealCommand(candidates, async (candidate) => {
		return candidate === candidates[2];
	});
	assertEquals(command, candidates[2]);
});

Deno.test("findSurrealCommand: reports a clear error when no CLI is available", async () => {
	await assertRejects(
		() => findSurrealCommand(["bundle/surreal.exe", "surreal"], async () => false),
		Error,
		"bundle内",
	);
});

Deno.test("powerShellStartScript hides the child process and quotes paths", () => {
	const script = powerShellStartScript(
		"C:\\Users\\Yudai A\\Radiora V2",
		"C:\\Program Files\\Radiora\\surreal.exe",
		["start", "rocksdb:C:\\Users\\Yudai A\\Radiora V2\\main.db"],
	);
	assertStringIncludes(script, "-WindowStyle Hidden");
	assertStringIncludes(script, "-FilePath 'C:\\Program Files\\Radiora\\surreal.exe'");
	assertStringIncludes(
		script,
		"-ArgumentList @('start', 'rocksdb:C:\\Users\\Yudai A\\Radiora V2\\main.db')",
	);
	assertStringIncludes(script, "-WorkingDirectory 'C:\\Users\\Yudai A\\Radiora V2'");
});

Deno.test("powerShellStopScript terminates the hidden process tree", () => {
	const script = powerShellStopScript(1234, 8012);
	assertStringIncludes(script, "netstat.exe -ano -p tcp");
	assertStringIncludes(script, "127\\.0\\.0\\.1:8012");
	assertStringIncludes(script, "Stop-Process -Id $listenerPid -Force");
	assertStringIncludes(script, "Get-Process -Id 1234");
});

Deno.test("powerShellRecoverListenerScript only stops SurrealDB on the application port", () => {
	const script = powerShellRecoverListenerScript(8012);
	assertStringIncludes(script, "netstat.exe -ano -p tcp");
	assertStringIncludes(script, "127\\.0\\.0\\.1:8012");
	assertStringIncludes(script, "$target.ProcessName -ne 'surreal'");
	assertStringIncludes(script, "Stop-Process -Id $target.Id -Force");
});
