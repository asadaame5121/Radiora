import { assertEquals, assertRejects } from "jsr:@std/assert";
import { surrealCommandCandidates, SurrealProcess } from "./surreal_process.ts";

const sep = Deno.build.os === "windows" ? "\\" : "/";

function bundledProcess(dir: string): SurrealProcess {
	return new SurrealProcess(
		`${dir}${sep}main.db`,
		"127.0.0.1",
		8012,
		undefined,
		dir,
	);
}

function writeExecutable(dir: string, name: string, content: string): string {
	const path = `${dir}${sep}${name}`;
	Deno.writeTextFileSync(path, content);
	Deno.chmodSync(path, 0o755);
	return path;
}

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

Deno.test("findCommand: prefers the executable bundled next to the app", async () => {
	const tmp = await Deno.makeTempDir();
	try {
		writeExecutable(
			tmp,
			"surreal.exe",
			"#!/bin/sh\nprintf 'surrealdb 3.0.0 for windows'\n",
		);
		const process = bundledProcess(tmp);
		assertEquals(await process.findCommand(), `${tmp}${sep}surreal.exe`);
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
});

Deno.test("findCommand: skips a bundled executable that fails the version probe", async () => {
	const tmp = await Deno.makeTempDir();
	try {
		writeExecutable(tmp, "surreal.exe", "#!/bin/sh\necho broken >&2\nexit 1\n");
		const process = bundledProcess(tmp);
		await assertRejects(() => process.findCommand(), Error, "SurrealDB CLI 3.x");
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
});

Deno.test("findCommand: reports a clear error when no CLI is available", async () => {
	const tmp = await Deno.makeTempDir();
	try {
		const process = bundledProcess(tmp);
		await assertRejects(() => process.findCommand(), Error, "bundle内");
	} finally {
		await Deno.remove(tmp, { recursive: true });
	}
});
