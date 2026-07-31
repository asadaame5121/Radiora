import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("manuscript view projects a selected occurrence through the shared binding", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const component = await Deno.readTextFile(
		new URL("../src/ui/ManuscriptView.svelte", import.meta.url),
	);
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);
	const registration = await Deno.readTextFile(
		new URL("../src/desktop/register_bindings.ts", import.meta.url),
	);
	const facade = await Deno.readTextFile(
		new URL("../src/services/outline_service.ts", import.meta.url),
	);

	assertMatch(app, /api\.projectManuscript\(rootOccurrenceId\)/);
	assertMatch(app, /<ManuscriptView[\s\S]*sections=\{manuscriptSections\}/);
	assertMatch(bindings, /projectManuscript\(rootOccurrenceId: string\)/);
	assertMatch(
		registration,
		/projectManuscript: \(rootOccurrenceId\) => service\(\)\.projectManuscript\(rootOccurrenceId\)/,
	);
	assertMatch(
		facade,
		/new ManuscriptProjectionService\(this\.store\)\.project\(rootOccurrenceId\)/,
	);
	assert(component.includes("measureManuscript(sections)"));
});

Deno.test("manuscript editing reuses autosave and keeps pinned revisions read-only", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const component = await Deno.readTextFile(
		new URL("../src/ui/ManuscriptView.svelte", import.meta.url),
	);

	assertMatch(
		app,
		/updateManuscriptText\([\s\S]*updateLocalText\(section\.occurrenceId, textarea\)/,
	);
	assertMatch(component, /section\.revisionSelector\.mode === "branch"/);
	assertMatch(component, /<MarkdownEditor/);
	assertMatch(component, /vocabulary\.manuscriptReadOnly/);
	assertMatch(component, /vocabulary\.manuscriptTotalCount/);
	assertMatch(component, /vocabulary\.manuscriptBranchCount/);
	assertFalse(/実身|化身/.test(component));
});
