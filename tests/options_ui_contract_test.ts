import { assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

Deno.test("Option is a dedicated management view and the toolbar keeps only direct actions", () => {
	assertMatch(app, /\| "options";/);
	assertMatch(app, /viewMode === "options"/);
	assertMatch(app, /<section class="options-panel"/);
	assertNotMatch(app, /<details class="toolbar-menu">/);
	assertMatch(app, /onclick=\{exportMarkdown\}/);
	assertMatch(app, /onclick=\{\(\) => \(viewMode = "options"\)\}>Option<\/button>/);
});

Deno.test("Option groups export, exchange, backup, and live display settings", () => {
	for (const heading of ["書き出し", "データ交換", "バックアップ", "表示"]) {
		assertMatch(app, new RegExp(`<h2[^>]*>${heading}</h2>`));
	}
	assertMatch(app, /bind:value=\{markdownExportPreference\.referenceMode\}/);
	assertMatch(app, /bind:this=\{opmlFileInput\}/);
	assertMatch(app, /bind:this=\{jsonBackupFileInput\}/);
	assertMatch(app, /setTreeProjectionPreference/);
	assertMatch(app, /setNavigationCollapsed/);
	assertMatch(app, /setInspectorCollapsed/);
	assertMatch(app, /setInspectorWidth/);
});
