import { assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const viewMode = await Deno.readTextFile(new URL("../src/ui/app_view_mode.ts", import.meta.url));
const navigation = await Deno.readTextFile(
	new URL("../src/ui/PrimaryNavigation.svelte", import.meta.url),
);
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));

Deno.test("Option is a dedicated management view and the toolbar keeps only direct actions", () => {
	assertMatch(viewMode, /\| "options";/);
	assertMatch(navigation, /activeView === "options"/);
	assertMatch(navigation, /onclick=\{onOpenOptions\}>Option<\/button>/);
	assertMatch(app, /viewMode === "options"/);
	assertMatch(app, /<OptionsView/);
	assertMatch(view, /<section class="options-panel"/);
	assertNotMatch(app, /<details class="toolbar-menu">/);
	assertMatch(view, /onclick=\{onExportMarkdown\}/);
	assertMatch(app, /onOpenOptions=\{\(\) => \(viewMode = "options"\)\}/);
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
