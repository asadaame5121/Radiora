import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const menu = await readFile(
	new URL("../../../src/ui/occurrence_context_menu_controller.svelte.ts", import.meta.url),
	"utf8",
);
const tree = await readFile(
	new URL("../../../src/ui/PhylogeneticTree.svelte", import.meta.url),
	"utf8",
);
const inspector = await readFile(
	new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
	"utf8",
);
const historyTab = await readFile(
	new URL("../../../src/ui/InspectorHistoryTab.svelte", import.meta.url),
	"utf8",
);

const outlineRowItem = await readFile(
	new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
	"utf8",
);

test("outline and tree share the occurrence context menu without intercepting editors", () => {
	expect(app).toMatch(/<ContextMenu/);
	expect(outlineRowItem).toMatch(/openOccurrenceContextMenu\(row\.item\.id, "outline", event\)/);
	expect(menu).toMatch(/source === "outline" && isEditableTarget\(event\.target\)/);
	expect(app).toMatch(
		/onContextMenu=\{\(id, event\) => openOccurrenceContextMenu\(id, "tree", event\)\}/,
	);
	expect(tree).toMatch(/event\.key === "ContextMenu"/);
	expect(tree).toMatch(/event\.shiftKey && event\.key === "F10"/);
	expect(tree).toMatch(/oncontextmenu=/);
});

test("context actions reuse commands and confirmation-gated destructive paths", () => {
	for (const id of [
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
	]) {
		expect(app.includes(`id: "${id}"`)).toBeTruthy();
	}
	expect(menu).toMatch(/"create-branch": "createBranch"/);
	expect(menu).toMatch(/this\.ports\.execute\(command\)/);
	expect(app).toMatch(/"trash-work": \(\) => commandExecution\.run\(trashSelectedWork\)/);
	expect(app).toMatch(
		/"export-selected": \(id\) => commandExecution\.execute\("exportMarkdown", \{ exportOccurrenceId: id \}\)/,
	);
	expect(app).toMatch(/bookmarkController\.bookmarks\.some/);
});

test("persistent row and inspector destructive buttons moved into the context menu", () => {
	expect(outlineRowItem).not.toMatch(
		/class="delete" title=\{`この\$\{vocabulary\.occurrence\}を外す`\}/,
	);
	expect(inspector).not.toMatch(/onclick=\{duplicateSelectedOccurrence\}/);
	expect(inspector).not.toMatch(/onclick=\{trashSelectedWork\}/);
	expect(historyTab).toMatch(/onclick=\{\(\) => void onCreateBranch\(\)\}/);
	expect(inspector).toMatch(/onCreateBranch=\{props\.onCreateBranch\}/);
	expect(app).toMatch(/onCreateBranch=\{\(\) => executeCommand\("createBranch"\)\}/);
});
