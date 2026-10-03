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
	assertMatch(navigation, /aria-label="Option"[\s\S]*?onclick=\{onOpenOptions\}>⚙<\/button>/);
	assertMatch(navigation, /aria-label="ヘルプ"[\s\S]*?onclick=\{onOpenHelp\}>\?<\/button>/);
	assertMatch(navigation, /class="nav-icon-row"/);
	assertNotMatch(navigation, />ゴミ箱<\/button>/);
	assertMatch(app, /viewMode === "options"/);
	assertMatch(app, /<OptionsView/);
	assertMatch(view, /<section class="options-panel"/);
	assertNotMatch(app, /<details class="toolbar-menu">/);
	assertMatch(view, /onclick=\{onExportMarkdown\}/);
	assertMatch(app, /onOpenOptions=\{\(\) => \(viewMode = "options"\)\}/);
	assertMatch(view, /onclick=\{onOpenTrash\}>項目を復元する<\/button>/);
	assertMatch(app, /onOpenTrash=\{\(\) => void openTrash\(\)\}/);
});

Deno.test("top bar does not duplicate navigation and command actions", async () => {
	const topBar = await Deno.readTextFile(new URL("../src/ui/AppTopBar.svelte", import.meta.url));
	assertNotMatch(topBar, />Option<\/button>/);
	assertNotMatch(topBar, />ヘルプ<\/button>/);
	assertNotMatch(topBar, /markdownExportAction/);
});

Deno.test("Option groups export, exchange, backup, and live display settings", () => {
	for (const heading of ["書き出し", "データ交換", "バックアップ", "表示"]) {
		assertMatch(view, new RegExp(`<h2[^>]*>${heading}</h2>`));
	}
	assertMatch(
		view,
		/value=\{markdownExportPreference\.referenceMode\} onchange=\{updateMarkdownExportReferenceMode\}/,
	);
	assertMatch(view, /bind:this=\{opmlFileInput\}/);
	assertMatch(view, /bind:this=\{jsonBackupFileInput\}/);
	assertMatch(app, /setTreeProjectionPreference/);
	assertMatch(app, /setNavigationCollapsed/);
	assertMatch(app, /setInspectorCollapsed/);
	assertMatch(app, /setInspectorWidth/);
});
