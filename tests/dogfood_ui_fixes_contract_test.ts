import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const inspector = await Deno.readTextFile(
	new URL("../src/ui/InspectorView.svelte", import.meta.url),
);
const editor = await Deno.readTextFile(
	new URL("../src/ui/MarkdownEditor.svelte", import.meta.url),
);

Deno.test("inspector modes are mutually exclusive and header does not duplicate clear-selection actions", () => {
	assertMatch(inspector, /<Tabs\.Root[\s\S]*?value=\{tabValue\}/);
	assertMatch(inspector, /<Tabs\.Content value="overview">/);
	assertMatch(inspector, /<Tabs\.Content value="relation">/);
	assertMatch(inspector, /<Tabs\.Content value="history">/);
	assertNotMatch(inspector, /asideMode === "tags"/);
	assertNotMatch(inspector, /class="clear-selection"/);
	assertNotMatch(inspector, /\{#if asideMode === "overview" &&/);
});

const outlineRowItem = await Deno.readTextFile(
	new URL("../src/ui/OutlineRowItem.svelte", import.meta.url),
);

Deno.test("outline provides non-button Zoom and preserves an explicit return path", () => {
	assertMatch(app, /function hoistOccurrence\(id: string\)/);
	assertMatch(outlineRowItem, /ondblclick=\{\(\) => handlers\.hoistOccurrence\(row\.item\.id\)\}/);
	assertMatch(app, /if \(browsingLocation\.hoistOccurrenceId\)/);
	assertMatch(app, /requestClearHoist/);
	assertNotMatch(app, /onclick=\{requestHoist\}/);
	assertNotMatch(inspector, /class="clear-selection"/);
});

Deno.test("compact OverType hosts contain their overlay layers and reserve selected-row controls", () => {
	assertMatch(editor, /\.markdown-editor-host \{[\s\S]*?position: relative/);
	assertMatch(
		editor,
		/\.markdown-editor-host :global\(\.overtype-container\)/,
	);
	assertMatch(editor, /:global\(\.row\.selected\) \.markdown-editor,[\s\S]*?padding-bottom: 22px/);
	assertMatch(editor, /\.markdown-editor-mode \{[\s\S]*?display: none/);
	assertMatch(editor, /\.markdown-editor-mode \{[\s\S]*?bottom: 0/);
	assertMatch(
		editor,
		/:global\(\.row\.has-body:not\(\.selected\):not\(:focus-within\)\) \.markdown-editor-host \{/,
	);
	assertMatch(editor, /\.overtype-preview > div:nth-child\(n \+ 3\)/);
});
