import { assertEquals, assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

Deno.test("blank area click deselects selection and releases editor focus", () => {
	assertMatch(app, /function deselectFromBlank\(event: MouseEvent\): void \{/);
	assertMatch(app, /if \(event\.button !== 0 \|\| draggedId\) return;/);
	assertMatch(app, /releaseEditorFocus\(\);/);
	assertMatch(app, /selectOccurrence\(null\);/);
	assertMatch(app, /function releaseEditorFocus\(\): void \{/);
	assertMatch(
		app,
		/if \(active instanceof HTMLTextAreaElement && active\.dataset\.itemId !== undefined\)/,
	);
	assertMatch(app, /active\.blur\(\);/);
});

Deno.test("outline rows container and row blank areas both dispatch deselect", () => {
	const handlers = app.match(
		/event\.target === event\.currentTarget\) deselectFromBlank\(event\)/g,
	);
	assertEquals((handlers ?? []).length, 2);
	const rowsRegion = app.slice(app.indexOf('<div class="rows"'), app.indexOf("dropOn(row.item)"));
	assertMatch(rowsRegion, /event\.target === event\.currentTarget\) deselectFromBlank\(event\)/);
});

Deno.test("editing a row still selects it via textarea focus", () => {
	assertMatch(app, /onFocus=\{\(\) => selectOccurrence\(row\.item\.id\)\}/);
});
