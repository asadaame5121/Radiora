import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));
const editorController = await Deno.readTextFile(
	new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
);

Deno.test("Markdown export flushes edits, renders the active snapshot, and downloads UTF-8 Markdown", () => {
	assertMatch(
		app,
		/async function performMarkdownExport\(selectedOccurrenceId\?: string\): Promise<void> \{[\s\S]*?await editorController\.flushAutosave\(\);[\s\S]*?selectMarkdownExportSnapshot\(snapshot,[\s\S]*?renderOutlineSnapshotMarkdown\(exportSnapshot\)[\s\S]*?rewriteMarkdownExportReferences\(/,
	);
	assertMatch(app, /new Blob\(\[markdown\], \{ type: "text\/markdown;charset=utf-8" \}\)/);
	assertMatch(app, /anchor\.download = `radiora-\$\{localDateValue\(new Date\(\)\)\}\.md`/);
	assertMatch(
		app,
		/document\.body\.append\(anchor\);[\s\S]*?anchor\.click\(\);[\s\S]*?anchor\.remove\(\);/,
	);
	assertMatch(app, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/);
	assertMatch(app, /case "exportMarkdown": await performMarkdownExport\(\)/);
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
	assertMatch(app, /Markdownをエクスポートしました。/);
	assertMatch(app, /Markdownをエクスポートできませんでした/);
});

Deno.test("Markdown export exposes persisted selected-node scope and independent advanced options", () => {
	assertMatch(app, /let markdownExportPreference = \$state\(loadMarkdownExportPreference\(\)\)/);
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
	assertMatch(app, /saveMarkdownExportPreference\(\{ \.\.\.markdownExportPreference \}\)/);
	assertMatch(
		app,
		/markdownExportPreference\.scope === "selected" && !selectedItem/,
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
		app,
		/markdownExportPreference\.referenceMode === "obsidian"[\s\S]*?api\.resolveInternalReferences\(rendered\)/,
	);
});
