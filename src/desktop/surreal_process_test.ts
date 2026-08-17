import { assertEquals, assertRejects } from "jsr:@std/assert";
import { findSurrealCommand, surrealCommandCandidates } from "./surreal_process.ts";

const sep = Deno.build.os === "windows" ? "\\" : "/";
const surrealCliName = Deno.build.os === "windows" ? "surreal.exe" : "surreal";
const surrealSidecarName = "radiora-surreal.exe";

Deno.test("surrealCommandCandidates: bundle directory is searched first", () => {
	const candidates = surrealCommandCandidates(
		`C:${sep}apps${sep}radiora`,
		`C:${sep}Users${sep}taro`,
	);
	assertEquals(candidates, [
		...(Deno.build.os === "windows"
			? [`C:${sep}apps${sep}radiora${sep}${surrealSidecarName}`]
			: []),
		`C:${sep}apps${sep}radiora${sep}${surrealCliName}`,
		"surreal",
		`C:${sep}Users${sep}taro${sep}.surrealdb${sep}${surrealCliName}`,
	]);
});

Deno.test("surrealCommandCandidates: omits empty locations", () => {
	assertEquals(surrealCommandCandidates(null, null), ["surreal"]);
	assertEquals(surrealCommandCandidates(`C:${sep}apps${sep}radiora`, null), [
		...(Deno.build.os === "windows"
			? [`C:${sep}apps${sep}radiora${sep}${surrealSidecarName}`]
			: []),
		`C:${sep}apps${sep}radiora${sep}${surrealCliName}`,
		"surreal",
	]);
	assertEquals(surrealCommandCandidates(null, `C:${sep}Users${sep}taro`), [
		"surreal",
		`C:${sep}Users${sep}taro${sep}.surrealdb${sep}${surrealCliName}`,
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
