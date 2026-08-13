import { assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));

Deno.test("Option is a dedicated management view and the toolbar keeps only direct actions", () => {
	assertMatch(app, /\| "options";/);
	assertMatch(app, /viewMode === "options"/);
	assertMatch(app, /<OptionsView/);
	assertMatch(view, /<section class="options-panel"/);
	assertNotMatch(app, /<details class="toolbar-menu">/);
	assertMatch(view, /onclick=\{onExportMarkdown\}/);
	assertMatch(app, /onclick=\{\(\) => \(viewMode = "options"\)\}>Option<\/button>/);
});

Deno.test("Option groups export, exchange, backup, and live display settings", () => {
	for (const heading of ["書き出し", "データ交換", "バックアップ", "表示"]) {
		assertMatch(view, new RegExp(`<h2[^>]*>${heading}</h2>`));
	}
	assertMatch(view, /bind:value=\{markdownExportPreference\.referenceMode\}/);
	assertMatch(view, /bind:this=\{opmlFileInput\}/);
	assertMatch(view, /bind:this=\{jsonBackupFileInput\}/);
	assertMatch(app, /setTreeProjectionPreference/);
	assertMatch(app, /setNavigationCollapsed/);
	assertMatch(app, /setInspectorCollapsed/);
	assertMatch(app, /setInspectorWidth/);
});

Deno.test("Option manages runtime semantic relation definitions", () => {
	assertMatch(view, /relationTypeDefinitions: readonly RelationTypeDefinition\[\]/);
	assertMatch(view, /<h2[^>]*>意味関係<\/h2>/);
	assertMatch(view, /bind:value=\{relationTypeName\}/);
	assertMatch(view, /type="radio" bind:group=\{relationTypeDirection\} value="directed"/);
	assertMatch(view, /type="radio" bind:group=\{relationTypeDirection\} value="symmetric"/);
	assertMatch(view, /await onCreateRelationTypeDefinition\(\{/);
	assertMatch(app, /relationTypeDefinitions=\{relationTypes\.definitions\}/);
	assertMatch(app, /onCreateRelationTypeDefinition=\{relationTypes\.create\}/);
});
