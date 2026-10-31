import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const outlineView = await readFile(
	new URL("../../../src/ui/OutlineView.svelte", import.meta.url),
	"utf8",
);
const outlineRowItem = await readFile(
	new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
	"utf8",
);

test("blank area click deselects selection and releases editor focus", () => {
	expect(app).toMatch(/function deselectFromBlank\(event: MouseEvent\): void \{/);
	expect(app).toMatch(/if \(event\.button !== 0 \|\| outlineDrag\.draggedId\) return;/);
	expect(app).toMatch(/selectOccurrence\(null, releaseEditorFocus\);/);
	expect(app).toMatch(/function releaseEditorFocus\(\): void \{/);
	expect(app).toMatch(
		/if \(active instanceof HTMLTextAreaElement && active\.dataset\.itemId !== undefined\)/,
	);
	expect(app).toMatch(/active\.blur\(\);/);
});

test("outline rows container and row blank areas both dispatch deselect", () => {
	expect(outlineView).toMatch(
		/event\.target === event\.currentTarget\) handlers\.deselectFromBlank\(event\)/,
	);
	expect(outlineRowItem).toMatch(
		/event\.target === event\.currentTarget\) handlers\.deselectFromBlank\(event\)/,
	);
});

test("editing a row still selects it via textarea focus", () => {
	expect(outlineRowItem).toMatch(
		/onFocus=\{\(\) => \{ if \(selectedId !== row\.item\.id\) handlers\.selectOccurrence\(row\.item\.id\); \}\}/,
	);
});
