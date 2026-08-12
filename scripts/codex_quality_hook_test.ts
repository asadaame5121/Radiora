import {
	biomeLintArgs,
	extractPatchPaths,
	isFormatFile,
	isLintFile,
	normalizeRelativePath,
} from "./codex_quality_hook.ts";

function assertEquals<T>(actual: T, expected: T): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

Deno.test("extracts files from apply_patch input", () => {
	assertEquals(
		extractPatchPaths("*** Update File: src/main.ts\n*** Add File: src/new.svelte"),
		["src/main.ts", "src/new.svelte"],
	);
});

Deno.test("rejects absolute and parent paths", () => {
	assertEquals(normalizeRelativePath("src/main.ts"), "src/main.ts");
	assertEquals(normalizeRelativePath("../outside.ts"), null);
	assertEquals(normalizeRelativePath("C:/outside.ts"), null);
});

Deno.test("formats supported project files and lints Biome languages", () => {
	assertEquals(isFormatFile("src/view.svelte"), true);
	assertEquals(isLintFile("src/view.svelte"), true);
	assertEquals(isLintFile("src/theme.css"), true);
	assertEquals(isLintFile("README.md"), false);
});

Deno.test("Biome hook enables safe writes without unsafe fixes", () => {
	const args = biomeLintArgs(["src/main.ts"]);
	assertEquals(args, [
		"exec",
		"--",
		"biome",
		"lint",
		"--write",
		"--no-errors-on-unmatched",
		"src/main.ts",
	]);
	assertEquals(args.includes("--unsafe"), false);
});
