import { assertMatch } from "jsr:@std/assert@1";

Deno.test("internal reference UI supports [[ completion, caret replacement, safe navigation, and backlinks", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
	);
	const vocabulary = await Deno.readTextFile(
		new URL("../src/shared/ui_vocabulary.ts", import.meta.url),
	);

	assertMatch(controller, /findInternalReferenceTrigger/);
	assertMatch(controller, /textarea\.setRangeText\(/);
	assertMatch(controller, /inputType: "insertReplacementText"/);
	assertMatch(controller, /listInternalReferenceCompletions/);
	assertMatch(controller, /resolveInternalReferences/);
	assertMatch(controller, /resolution\.status !== "resolved"/);
	assertMatch(controller, /openRevisionComparison\(resolution\.revision\.id\)/);
	assertMatch(controller, /listInternalReferenceBacklinks\("work", workId\)/);
	assertMatch(app, /editorController\.updateEditorSelection/);
	assertMatch(app, /vocabulary\.internalReference/);
	assertMatch(app, /vocabulary\.backlink/);
	assertMatch(vocabulary, /internalReference: "内部参照"/);
	assertMatch(vocabulary, /backlink: "被参照"/);
	assertMatch(controller, /resolution\.navigationTarget\.kind === "work"[\s\S]*?return;/);
});

Deno.test("internal reference UI does not create semantic or system graph relations", async () => {
	const controller = await Deno.readTextFile(
		new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
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
