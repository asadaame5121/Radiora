import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const menu = await Deno.readTextFile(
	new URL("../src/ui/occurrence_context_menu_controller.svelte.ts", import.meta.url),
);
const tree = await Deno.readTextFile(
	new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
);
const inspector = await Deno.readTextFile(
	new URL("../src/ui/InspectorView.svelte", import.meta.url),
);
const historyTab = await Deno.readTextFile(
	new URL("../src/ui/InspectorHistoryTab.svelte", import.meta.url),
);

const outlineRowItem = await Deno.readTextFile(
	new URL("../src/ui/OutlineRowItem.svelte", import.meta.url),
);

Deno.test("outline and tree share the occurrence context menu without intercepting editors", () => {
	assertMatch(app, /<ContextMenu/);
	assertMatch(outlineRowItem, /openOccurrenceContextMenu\(row\.item\.id, "outline", event\)/);
	assertMatch(menu, /source === "outline" && isEditableTarget\(event\.target\)/);
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
	assertMatch(menu, /"create-branch": "createBranch"/);
	assertMatch(menu, /this\.ports\.execute\(command\)/);
	assertMatch(app, /"trash-work": \(\) => commandExecution\.run\(trashSelectedWork\)/);
	assertMatch(
		app,
		/"export-selected": \(id\) => commandExecution\.execute\("exportMarkdown", \{ exportOccurrenceId: id \}\)/,
	);
	assertMatch(app, /\(bookmarks \?\? \[\]\)\.some/);
});

Deno.test("persistent row and inspector destructive buttons moved into the context menu", () => {
	assertNotMatch(
		outlineRowItem,
		/class="delete" title=\{`この\$\{vocabulary\.occurrence\}を外す`\}/,
	);
	assertNotMatch(inspector, /onclick=\{duplicateSelectedOccurrence\}/);
	assertNotMatch(inspector, /onclick=\{trashSelectedWork\}/);
	assertMatch(historyTab, /onclick=\{\(\) => void onCreateBranch\(\)\}/);
	assertMatch(inspector, /onCreateBranch=\{props\.onCreateBranch\}/);
	assertMatch(app, /onCreateBranch=\{\(\) => executeCommand\("createBranch"\)\}/);
});
