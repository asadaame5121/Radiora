import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const viewMode = await readFile(
	new URL("../../../src/ui/app_view_mode.ts", import.meta.url),
	"utf8",
);
const navigation = await readFile(
	new URL("../../../src/ui/PrimaryNavigation.svelte", import.meta.url),
	"utf8",
);
const view = await readFile(new URL("../../../src/ui/OptionsView.svelte", import.meta.url), "utf8");

test("Option is a dedicated management view and the toolbar keeps only direct actions", () => {
	expect(viewMode).toMatch(/\| "options";/);
	expect(navigation).toMatch(/activeView === "options"/);
	expect(navigation).toMatch(/aria-label="Option"[\s\S]*?onclick=\{onOpenOptions\}>⚙<\/button>/);
	expect(navigation).toMatch(/aria-label="ヘルプ"[\s\S]*?onclick=\{onOpenHelp\}>\?<\/button>/);
	expect(navigation).toMatch(/class="nav-icon-row"/);
	expect(navigation).not.toMatch(/>ゴミ箱<\/button>/);
	expect(app).toMatch(/viewMode === "options"/);
	expect(app).toMatch(/<OptionsView/);
	expect(view).toMatch(/<section class="options-panel"/);
	expect(app).not.toMatch(/<details class="toolbar-menu">/);
	expect(view).toMatch(/onclick=\{onExportMarkdown\}/);
	expect(app).toMatch(
		/onOpenOptions=\{\(\) => void screenNavigation\.navigate\(\{ view: "options" \}\)\}/,
	);
	expect(view).toMatch(/onclick=\{onOpenTrash\}>項目を復元する<\/button>/);
	expect(app).toMatch(/onOpenTrash=\{\(\) => void openTrash\(\)\}/);
});

test("top bar does not duplicate navigation and command actions", async () => {
	const topBar = await readFile(
		new URL("../../../src/ui/AppTopBar.svelte", import.meta.url),
		"utf8",
	);
	expect(topBar).not.toMatch(/>Option<\/button>/);
	expect(topBar).not.toMatch(/>ヘルプ<\/button>/);
	expect(topBar).not.toMatch(/markdownExportAction/);
});

test("Option groups export, exchange, backup, and live display settings", () => {
	for (const heading of ["書き出し", "データ交換", "バックアップ", "表示"]) {
		expect(view).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
	}
	expect(view).toMatch(
		/value=\{markdownExportPreference\.referenceMode\} onchange=\{updateMarkdownExportReferenceMode\}/,
	);
	expect(view).toMatch(/bind:this=\{opmlFileInput\}/);
	expect(view).toMatch(/bind:this=\{jsonBackupFileInput\}/);
	expect(app).toMatch(/treeProjectionPreference=\{tree\.projectionPreference\}/);
	expect(app).toMatch(/onTreeProjectionChange=\{\(next\) => tree\.setProjection\(next\)\}/);
	expect(app).toMatch(/setNavigationCollapsed/);
	expect(app).toMatch(/setInspectorCollapsed/);
	expect(app).toMatch(/setInspectorWidth/);
});
