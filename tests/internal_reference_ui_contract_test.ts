import { assertMatch } from "jsr:@std/assert@1";

Deno.test("internal reference UI supports [[ completion, caret replacement, safe navigation, and backlinks", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const vocabulary = await Deno.readTextFile(
		new URL("../src/shared/ui_vocabulary.ts", import.meta.url),
	);

	assertMatch(app, /findInternalReferenceTrigger/);
	assertMatch(app, /textarea\.setRangeText\(/);
	assertMatch(app, /inputType: "insertReplacementText"/);
	assertMatch(app, /listInternalReferenceCompletions/);
	assertMatch(app, /resolveInternalReferences/);
	assertMatch(app, /resolution\.status !== "resolved"/);
	assertMatch(app, /openRevisionComparison\(resolution\.revision\.id\)/);
	assertMatch(app, /listInternalReferenceBacklinks\("work", workId\)/);
	assertMatch(app, /vocabulary\.internalReference/);
	assertMatch(app, /vocabulary\.backlink/);
	assertMatch(vocabulary, /internalReference: "内部参照"/);
	assertMatch(vocabulary, /backlink: "被参照"/);
	assertMatch(app, /resolution\.navigationTarget\.kind === "work"[\s\S]*?return;/);
});

Deno.test("internal reference UI does not create semantic or system graph relations", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const referenceFunctions = app.slice(
		app.indexOf("async function updateInternalReferenceCompletion"),
		app.indexOf("async function performQuickCapture"),
	);

	if (/api\.(createLink|createItem|createOccurrence|quickCapture)/.test(referenceFunctions)) {
		throw new Error("Internal reference UI must remain a virtual Markdown relation");
	}
	if (/referenceStub/.test(referenceFunctions)) {
		throw new Error("Internal reference UI must not create a Stub");
	}
});
