import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const controller = await readFile(
	new URL("../../../src/ui/markdown_export_controller.svelte.ts", import.meta.url),
	"utf8",
);
const view = await readFile(new URL("../../../src/ui/OptionsView.svelte", import.meta.url), "utf8");
const editorController = await readFile(
	new URL("../../../src/ui/editor_controller.svelte.ts", import.meta.url),
	"utf8",
);
const download = await readFile(
	new URL("../../../src/ui/download_text_file.ts", import.meta.url),
	"utf8",
);

test("Markdown export flushes edits, renders the active snapshot, and downloads UTF-8 Markdown", () => {
	expect(controller).toMatch(
		/export = async[\s\S]*?await this\.ports\.flush\(\);[\s\S]*?selectMarkdownExportSnapshot\(this\.ports\.snapshot\(\),[\s\S]*?renderOutlineSnapshotMarkdown\(exportSnapshot\)[\s\S]*?rewriteMarkdownExportReferences\(/,
	);
	expect(controller).toMatch(
		/downloadTextFile\(\s*markdown,\s*"text\/markdown;charset=utf-8",\s*`radiora-\$\{localDateValue\(new Date\(\)\)\}\.md`,?\s*\)/,
	);
	expect(download).toMatch(
		/document\.body\.append\(anchor\);[\s\S]*?anchor\.click\(\);[\s\S]*?anchor\.remove\(\);/,
	);
	expect(download).toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/);
	expect(app).toMatch(
		/exportMarkdown: \(payload\) => markdownExport\.export\(payload\.exportOccurrenceId\)/,
	);
});

test("Markdown export delegates its pending-edit barrier to the editor controller", () => {
	expect(editorController).toMatch(
		/flushAutosave: \(workId\?: string\) => autosave\.flush\(workId\)/,
	);
});

test("Markdown export has a visible command button and success notification", () => {
	expect(app).toMatch(/onExportMarkdown=\{exportMarkdown\}/);
	expect(view).toMatch(/onclick=\{onExportMarkdown\}/);
	expect(view).toMatch(/disabled=\{!markdownExportEnabled \|\| markdownExportSelectionRequired\}/);
	expect(view).toMatch(/<small class="markdown-export-notice" role="status">/);
	expect(controller).toMatch(/Markdownをエクスポートしました。/);
	expect(controller).toMatch(/Markdownをエクスポートできませんでした/);
});

test("Markdown export exposes persisted selected-node scope and independent advanced options", () => {
	expect(controller).toMatch(/private _preference = \$state\(loadMarkdownExportPreference\(\)\)/);
	expect(view).toMatch(
		/value=\{markdownExportPreference\.scope\} onchange=\{updateMarkdownExportScope\}/,
	);
	expect(view).toMatch(/value="all">\{vocabulary\.markdownExportAll\}/);
	expect(view).toMatch(/<option value="selected">\{vocabulary\.markdownExportSelected\}<\/option>/);
	expect(view).toMatch(
		/checked=\{markdownExportPreference\.includeAncestors\} onchange=\{updateMarkdownExportIncludeAncestors\}/,
	);
	expect(view).toMatch(
		/checked=\{markdownExportPreference\.includeDescendants\} onchange=\{updateMarkdownExportIncludeDescendants\}/,
	);
	expect(view).toMatch(
		/checked=\{markdownExportPreference\.includeSemanticNeighbors\} onchange=\{updateMarkdownExportIncludeSemanticNeighbors\}/,
	);
	expect(controller).toMatch(/saveMarkdownExportPreference\(this\._preference\)/);
	expect(app).toMatch(/markdownExport\.preference\.scope === "selected" && !selectedItem/);
	expect(view).toMatch(/vocabulary\.markdownExportSelectionRequired/);
});

test("Markdown export exposes all reference modes through shared vocabulary", () => {
	expect(view).toMatch(
		/value=\{markdownExportPreference\.referenceMode\} onchange=\{updateMarkdownExportReferenceMode\}/,
	);
	expect(view).toMatch(/value="radiora">\{vocabulary\.markdownExportRadiora\}/);
	expect(view).toMatch(/value="portable">\{vocabulary\.markdownExportPortable\}/);
	expect(view).toMatch(/value="obsidian">\{vocabulary\.markdownExportObsidian\}/);
	expect(controller).toMatch(
		/preference\.referenceMode === "obsidian"[\s\S]*?this\.ports\.api\.resolveInternalReferences\(rendered\)/,
	);
});
