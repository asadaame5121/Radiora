import { assertEquals, assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const outlineView = await Deno.readTextFile(
	new URL("../src/ui/OutlineView.svelte", import.meta.url),
);
const outlineRowItem = await Deno.readTextFile(
	new URL("../src/ui/OutlineRowItem.svelte", import.meta.url),
);

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
	assertMatch(
		outlineView,
		/event\.target === event\.currentTarget\) handlers\.deselectFromBlank\(event\)/,
	);
	assertMatch(
		outlineRowItem,
		/event\.target === event\.currentTarget\) handlers\.deselectFromBlank\(event\)/,
	);
});

Deno.test("editing a row still selects it via textarea focus", () => {
	assertMatch(outlineRowItem, /onFocus=\{\(\) => handlers\.selectOccurrence\(row\.item\.id\)\}/);
});
