import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const inspector = await Deno.readTextFile(
	new URL("../src/ui/InspectorView.svelte", import.meta.url),
);
const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

Deno.test("inspector modes are mutually exclusive and header does not duplicate clear-selection actions", () => {
	assertMatch(inspector, /<Tabs\.Root[\s\S]*?value=\{tabValue\}/);
	assertMatch(inspector, /<Tabs\.Content value="overview">/);
	assertMatch(inspector, /<Tabs\.Content value="relation">/);
	assertMatch(inspector, /<Tabs\.Content value="history">/);
	assertNotMatch(inspector, /asideMode === "tags"/);
	assertNotMatch(inspector, /class="clear-selection"/);
	assertNotMatch(inspector, /\{#if asideMode === "overview" &&/);
});

Deno.test("outline provides non-button Zoom and preserves an explicit return path", () => {
	assertMatch(app, /function hoistOccurrence\(id: string\)/);
	assertMatch(app, /ondblclick=\{\(\) => hoistOccurrence\(row\.item\.id\)\}/);
	assertMatch(app, /if \(browsingLocation\.hoistOccurrenceId\)/);
	assertMatch(app, /requestClearHoist/);
	assertNotMatch(app, /onclick=\{requestHoist\}/);
	assertNotMatch(inspector, /class="clear-selection"/);
});

Deno.test("compact OverType hosts contain their overlay layers and reserve selected-row controls", () => {
	assertMatch(styles, /\.markdown-editor-host \{[\s\S]*?position: relative/);
	assertMatch(
		styles,
		/\.markdown-editor-host :is\(\.overtype-container, \.overtype-wrapper\) \{[\s\S]*?min-height: 0 !important[\s\S]*?overflow: hidden !important/,
	);
	assertMatch(styles, /\.row\.selected \.markdown-editor,[\s\S]*?padding-top: 22px/);
	assertMatch(styles, /\.markdown-editor-mode \{[\s\S]*?display: none/);
	assertMatch(
		styles,
		/\.row\.has-body:not\(\.selected\):not\(:focus-within\) \.markdown-editor-host \{/,
	);
	assertMatch(styles, /\.overtype-preview > div:nth-child\(n \+ 3\)/);
});
