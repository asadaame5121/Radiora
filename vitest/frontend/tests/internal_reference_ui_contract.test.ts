import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("internal reference UI supports [[ completion, caret replacement, safe navigation, and backlinks", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const inspector = await readFile(
		new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
		"utf8",
	);
	const relationTab = await readFile(
		new URL("../../../src/ui/InspectorRelationTab.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/editor_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const completion = await readFile(
		new URL("../../../src/ui/editor_completion_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const vocabulary = await readFile(
		new URL("../../../src/shared/ui_vocabulary.ts", import.meta.url),
		"utf8",
	);

	const outlineRowItem = await readFile(
		new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
		"utf8",
	);

	expect(completion).toMatch(/findInternalReferenceTrigger/);
	expect(completion).toMatch(/textarea\.setRangeText\(/);
	expect(completion).toMatch(/inputType: "insertReplacementText"/);
	expect(completion).toMatch(/listInternalReferenceCompletions/);
	expect(controller).toMatch(/resolveInternalReferences/);
	expect(controller).toMatch(/resolution\.status !== "resolved"/);
	expect(controller).toMatch(/revisionId: resolution\.revision\.id/);
	expect(controller).toMatch(/listInternalReferenceBacklinks\("work", workId\)/);
	expect(app).toMatch(/editorController\.updateEditorSelection/);
	expect(outlineRowItem).toMatch(/vocabulary\.internalReference/);
	expect(inspector).toMatch(/<InspectorRelationTab/);
	expect(relationTab).toMatch(/vocabulary\.backlink/);
	expect(vocabulary).toMatch(/internalReference: "メモへのリンク"/);
	expect(vocabulary).toMatch(/backlink: "このメモへのリンク"/);
	expect(controller).toMatch(/resolution\.navigationTarget\.kind === "work"[\s\S]*?return;/);
});

test("internal reference UI does not create semantic or system graph relations", async () => {
	const controller = await readFile(
		new URL("../../../src/ui/editor_completion_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const referenceFunctions = controller.slice(
		controller.indexOf("async function updateInternalReferenceCompletion"),
		controller.indexOf("async function updateInlineLinkCompletion"),
	);

	if (/api\.(createLink|createItem|createOccurrence|quickCapture)/.test(referenceFunctions)) {
		throw new Error("Internal reference UI must remain a virtual Markdown relation");
	}
	if (/referenceStub/.test(referenceFunctions)) {
		throw new Error("Internal reference UI must not create a Stub");
	}
});
