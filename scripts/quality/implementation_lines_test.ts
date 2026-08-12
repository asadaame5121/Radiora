import {
	allowedImplementationLines,
	countImplementationLines,
	isProductionSource,
} from "./implementation_lines.ts";

function assertEquals<T>(actual: T, expected: T): void {
	if (actual !== expected) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

Deno.test("TypeScript comments and blank lines are excluded", () => {
	const source = [
		"const first = 1; // trailing comment",
		"",
		"// line comment",
		"/* block",
		" * comment",
		" */",
		"const second = 2;",
	].join("\n");
	assertEquals(countImplementationLines(source, "typescript"), 2);
});

Deno.test("comment markers inside strings and template literals remain implementation", () => {
	const source = [
		'const url = "https://example.com/a/*b*/";',
		"const marker = '// not a comment';",
		"const template = `<!-- still text -->`;",
	].join("\n");
	assertEquals(countImplementationLines(source, "typescript"), 3);
});

Deno.test("Svelte HTML, script, and style comment-only lines are excluded", () => {
	const source = [
		"<!-- markup comment -->",
		"<script>",
		"// script comment",
		"const url = 'https://example.com';",
		"</script>",
		"<main>content</main>",
		"<style>",
		"/* style comment */",
		"main { color: red; }",
		"</style>",
	].join("\n");
	assertEquals(countImplementationLines(source, "svelte"), 7);
});

Deno.test("400 new implementation lines pass and 401 fail", () => {
	const baseline: Record<string, number> = {};
	assertEquals(400 <= allowedImplementationLines("src/new.ts", baseline), true);
	assertEquals(401 <= allowedImplementationLines("src/new.ts", baseline), false);
});

Deno.test("legacy limits ratchet above 400 without lowering the default", () => {
	assertEquals(allowedImplementationLines("src/legacy.ts", { "src/legacy.ts": 523 }), 523);
	assertEquals(allowedImplementationLines("src/small.ts", { "src/small.ts": 200 }), 400);
});

Deno.test("tests, fixtures, declarations, and generated folders are excluded", () => {
	assertEquals(isProductionSource("src/service.ts"), true);
	assertEquals(isProductionSource("src/service_test.ts"), false);
	assertEquals(isProductionSource("src/view.test.ts"), false);
	assertEquals(isProductionSource("src/fixtures/input.ts"), false);
	assertEquals(isProductionSource("src/generated/bindings.ts"), false);
	assertEquals(isProductionSource("src/types.d.ts"), false);
});
