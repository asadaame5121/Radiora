import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const inspector = await readFile(
	new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
	"utf8",
);
const editor = await readFile(
	new URL("../../../src/ui/MarkdownEditor.svelte", import.meta.url),
	"utf8",
);

test("inspector modes are mutually exclusive and header does not duplicate clear-selection actions", () => {
	expect(inspector).toMatch(/<Tabs\.Root[\s\S]*?value=\{tabValue\}/);
	expect(inspector).toMatch(/<Tabs\.Content value="overview">/);
	expect(inspector).toMatch(/<Tabs\.Content value="relation">/);
	expect(inspector).toMatch(/<Tabs\.Content value="history">/);
	expect(inspector).not.toMatch(/asideMode === "tags"/);
	expect(inspector).not.toMatch(/class="clear-selection"/);
	expect(inspector).not.toMatch(/\{#if asideMode === "overview" &&/);
});

const outlineRowItem = await readFile(
	new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
	"utf8",
);

test("outline provides non-button Zoom and preserves an explicit return path", () => {
	expect(app).toMatch(/function hoistOccurrence\(id: string\)/);
	expect(outlineRowItem).toMatch(
		/ondblclick=\{\(\) => handlers\.hoistOccurrence\(row\.item\.id\)\}/,
	);
	expect(app).toMatch(/if \(browsingLocation\.hoistOccurrenceId\)/);
	expect(app).toMatch(/requestClearHoist/);
	expect(app).not.toMatch(/onclick=\{requestHoist\}/);
	expect(inspector).not.toMatch(/class="clear-selection"/);
});

test("compact OverType hosts contain their overlay layers and reserve selected-row controls", () => {
	expect(editor).toMatch(/\.markdown-editor-host \{[\s\S]*?position: relative/);
	expect(editor).toMatch(/\.markdown-editor-host :global\(\.overtype-container\)/);
	expect(editor).toMatch(
		/:global\(\.row\.selected\) \.markdown-editor,[\s\S]*?padding-bottom: 22px/,
	);
	expect(editor).toMatch(/\.markdown-editor-mode \{[\s\S]*?display: none/);
	expect(editor).toMatch(/\.markdown-editor-mode \{[\s\S]*?bottom: 0/);
	expect(editor).toMatch(
		/:global\(\.row\.has-body:not\(\.selected\):not\(:focus-within\)\) \.markdown-editor-host \{/,
	);
	expect(editor).toMatch(/\.overtype-preview > div:nth-child\(n \+ 3\)/);
});
