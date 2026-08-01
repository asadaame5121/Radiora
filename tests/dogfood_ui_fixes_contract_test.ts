import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

Deno.test("inspector modes are mutually exclusive and selection can be cleared", () => {
	const inspector = app.slice(
		app.indexOf('<aside bind:this={inspectorElement} class="inspector">'),
		app.indexOf('{:else}\n\t\t\t\t<div class="aside-empty">'),
	);
	assertMatch(inspector, /\{#if asideMode === "overview"\}/);
	assertMatch(inspector, /\{:else if asideMode === "relation"\}/);
	assertMatch(inspector, /\{:else if asideMode === "history"\}/);
	assertNotMatch(inspector, /asideMode === "tags"/);
	assertMatch(
		inspector,
		/<button class="clear-selection" onclick=\{\(\) => selectOccurrence\(null\)\}>選択解除<\/button>/,
	);
	assertNotMatch(inspector, /\{#if asideMode === "overview" && bodyFor/);
});

Deno.test("outline provides non-button Zoom and preserves an explicit return path", () => {
	assertMatch(app, /function hoistOccurrence\(id: string\)/);
	assertMatch(app, /ondblclick=\{\(\) => hoistOccurrence\(row\.item\.id\)\}/);
	assertMatch(app, /if \(browsingLocation\.hoistOccurrenceId\)/);
	assertMatch(app, /requestClearHoist/);
	assertNotMatch(app, /onclick=\{requestHoist\}/);
	assertMatch(
		app,
		/<button class="clear-selection" onclick=\{\(\) => selectOccurrence\(null\)\}>選択解除<\/button>/,
	);
});

Deno.test("compact OverType hosts contain their overlay layers and reserve selected-row controls", () => {
	assertMatch(styles, /\.markdown-editor-host \{[\s\S]*?position: relative/);
	assertMatch(
		styles,
		/\.markdown-editor-host :is\(\.overtype-container, \.overtype-wrapper\) \{[\s\S]*?min-height: 0 !important[\s\S]*?overflow: hidden !important/,
	);
	assertMatch(styles, /\.row\.selected \.markdown-editor,[\s\S]*?padding-top: 22px/);
	assertMatch(styles, /\.markdown-editor-mode \{[\s\S]*?display: none/);
});
