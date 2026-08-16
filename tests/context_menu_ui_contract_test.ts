import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const tree = await Deno.readTextFile(
	new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
);
const inspector = await Deno.readTextFile(
	new URL("../src/ui/InspectorView.svelte", import.meta.url),
);

Deno.test("outline and tree share the occurrence context menu without intercepting editors", () => {
	assertMatch(app, /<ContextMenu/);
	assertMatch(app, /openOccurrenceContextMenu\(row\.item\.id, "outline", event\)/);
	assertMatch(app, /if \(source === "outline" && isEditableTarget\(event\.target\)\) return/);
	assertMatch(
		app,
		/onContextMenu=\{\(id, event\) => openOccurrenceContextMenu\(id, "tree", event\)\}/,
	);
	assertMatch(tree, /event\.key === "ContextMenu"/);
	assertMatch(tree, /event\.shiftKey && event\.key === "F10"/);
	assertMatch(tree, /oncontextmenu=/);
});

Deno.test("context actions reuse commands and confirmation-gated destructive paths", () => {
	for (
		const id of [
			"long-form",
			"bookmark",
			"duplicate",
			"create-link",
			"create-branch",
			"work-lineage",
			"revision-comparison",
			"export-selected",
			"remove-occurrence",
			"trash-work",
		]
	) {
		assert(app.includes(`id: "${id}"`));
	}
	assertMatch(app, /case "create-branch":[\s\S]*?executeCommand\("createBranch"\)/);
	assertMatch(app, /case "trash-work":[\s\S]*?trashSelectedWork\(\)/);
	assertMatch(app, /case "export-selected":[\s\S]*?performMarkdownExport\(targetId\)/);
	assertMatch(app, /\(bookmarks \?\? \[\]\)\.some/);
});

Deno.test("persistent row and inspector destructive buttons moved into the context menu", () => {
	const outline = app.slice(
		app.indexOf('<div class="rows">'),
		app.indexOf('{:else if viewMode === "today"}'),
	);
	assertNotMatch(outline, /class="delete" title=\{`この\$\{vocabulary\.occurrence\}を外す`\}/);
	assertNotMatch(inspector, /onclick=\{duplicateSelectedOccurrence\}/);
	assertNotMatch(inspector, /onclick=\{trashSelectedWork\}/);
	assertMatch(inspector, /onclick=\{\(\) => void onCreateBranch\(\)\}/);
	assertMatch(app, /onCreateBranch=\{\(\) => executeCommand\("createBranch"\)\}/);
});
