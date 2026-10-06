import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const controller = await Deno.readTextFile(
	new URL("../src/ui/markdown_export_controller.svelte.ts", import.meta.url),
);
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));
const editorController = await Deno.readTextFile(
	new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
);
const download = await Deno.readTextFile(
	new URL("../src/ui/download_text_file.ts", import.meta.url),
);

Deno.test("Markdown export flushes edits, renders the active snapshot, and downloads UTF-8 Markdown", () => {
	assertMatch(
		controller,
		/export = async[\s\S]*?await this\.ports\.flush\(\);[\s\S]*?selectMarkdownExportSnapshot\(this\.ports\.snapshot\(\),[\s\S]*?renderOutlineSnapshotMarkdown\(exportSnapshot\)[\s\S]*?rewriteMarkdownExportReferences\(/,
	);
	assertMatch(
		controller,
		/downloadTextFile\(\s*markdown,\s*"text\/markdown;charset=utf-8",\s*`radiora-\$\{localDateValue\(new Date\(\)\)\}\.md`,?\s*\)/,
	);
	assertMatch(
		download,
		/document\.body\.append\(anchor\);[\s\S]*?anchor\.click\(\);[\s\S]*?anchor\.remove\(\);/,
	);
	assertMatch(download, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/);
	assertMatch(
		app,
		/exportMarkdown: \(payload\) => markdownExport\.export\(payload\.exportOccurrenceId\)/,
	);
});

Deno.test("Markdown export delegates its pending-edit barrier to the editor controller", () => {
	assertMatch(editorController, /flushAutosave: \(workId\?: string\) => autosave\.flush\(workId\)/);
});

Deno.test("Markdown export has a visible command button and success notification", () => {
	assertMatch(app, /onExportMarkdown=\{exportMarkdown\}/);
	assertMatch(view, /onclick=\{onExportMarkdown\}/);
	assertMatch(
		view,
		/disabled=\{!markdownExportEnabled \|\| markdownExportSelectionRequired\}/,
	);
	assertMatch(view, /<small class="markdown-export-notice" role="status">/);
	assertMatch(controller, /Markdownをエクスポートしました。/);
	assertMatch(controller, /Markdownをエクスポートできませんでした/);
});

Deno.test("Markdown export exposes persisted selected-node scope and independent advanced options", () => {
	assertMatch(controller, /private _preference = \$state\(loadMarkdownExportPreference\(\)\)/);
	assertMatch(
		view,
		/value=\{markdownExportPreference\.scope\} onchange=\{updateMarkdownExportScope\}/,
	);
	assertMatch(view, /value="all">\{vocabulary\.markdownExportAll\}/);
	assertMatch(view, /<option value="selected">\{vocabulary\.markdownExportSelected\}<\/option>/);
	assertMatch(
		view,
		/checked=\{markdownExportPreference\.includeAncestors\} onchange=\{updateMarkdownExportIncludeAncestors\}/,
	);
	assertMatch(
		view,
		/checked=\{markdownExportPreference\.includeDescendants\} onchange=\{updateMarkdownExportIncludeDescendants\}/,
	);
	assertMatch(
		view,
		/checked=\{markdownExportPreference\.includeSemanticNeighbors\} onchange=\{updateMarkdownExportIncludeSemanticNeighbors\}/,
	);
	assertMatch(controller, /saveMarkdownExportPreference\(this\._preference\)/);
	assertMatch(
		app,
		/markdownExport\.preference\.scope === "selected" && !selectedItem/,
	);
	assertMatch(view, /vocabulary\.markdownExportSelectionRequired/);
});

Deno.test("Markdown export exposes all reference modes through shared vocabulary", () => {
	assertMatch(
		view,
		/value=\{markdownExportPreference\.referenceMode\} onchange=\{updateMarkdownExportReferenceMode\}/,
	);
	assertMatch(view, /value="radiora">\{vocabulary\.markdownExportRadiora\}/);
	assertMatch(view, /value="portable">\{vocabulary\.markdownExportPortable\}/);
	assertMatch(view, /value="obsidian">\{vocabulary\.markdownExportObsidian\}/);
	assertMatch(
		controller,
		/preference\.referenceMode === "obsidian"[\s\S]*?this\.ports\.api\.resolveInternalReferences\(rendered\)/,
	);
});
