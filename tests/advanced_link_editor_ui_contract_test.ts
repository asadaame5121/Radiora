import { assertMatch } from "jsr:@std/assert@1";

Deno.test("Advanced Link Editor exposes three-field gate, candidate metadata, and preview", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const editor = await Deno.readTextFile(
		new URL("../src/ui/AdvancedLinkEditor.svelte", import.meta.url),
	);

	assertMatch(app, /<AdvancedLinkEditor/);
	assertMatch(app, /selectedWorkId=\{selectedItem\.workId\}/);
	assertMatch(editor, /resolution\?\.source\.status === "resolved"/);
	assertMatch(editor, /resolution\.type\.status === "resolved"/);
	assertMatch(editor, /resolution\.target\.status === "resolved"/);
	assertMatch(editor, /disabled=\{!ready \|\| submitting\}/);
	assertMatch(editor, /candidate\.updatedAt/);
	assertMatch(editor, /candidate\.shortId/);
	assertMatch(editor, /placement\.breadcrumb\.join/);
	assertMatch(editor, /placement\.occurrenceId\.slice/);
	assertMatch(editor, /resolution\?\.preview/);
	assertMatch(editor, /await onConfirm/);
	assertMatch(editor, /initializedWorkId = ""/);
	assertMatch(editor, /reconcileAdvancedLinkSelections\(parsed, selections, selectionQueries\)/);
	assertMatch(app, /executeCommand\("createLink", undefined, input\)/);
	assertMatch(app, /\{ \.\.\.commandContext, hasLinkTarget: true \}/);
	assertMatch(app, /case "createLink": if \(linkInput\) await performAddLink\(linkInput\)/);
});

Deno.test("Advanced Link Editor does not create unresolved Works, Occurrences, or Stubs", async () => {
	const editor = await Deno.readTextFile(
		new URL("../src/ui/AdvancedLinkEditor.svelte", import.meta.url),
	);

	if (/api\.(createItem|createOccurrence|quickCapture|placeUnplacedWork)/.test(editor)) {
		throw new Error("Advanced Link Editor must not implicitly create graph entities");
	}
	if (/referenceStub/.test(editor)) {
		throw new Error("Advanced Link Editor must not create a reference Stub");
	}
	if (/api\.createLink/.test(editor)) {
		throw new Error("Advanced Link Editor must save through the shared command dispatcher");
	}
});
