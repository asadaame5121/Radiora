import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("Stub list view is reachable and acts only through bindings", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);

	for (const method of ["listStubs", "createStub", "resolveStub"]) {
		assert(bindings.includes(`${method}(`));
		assert(app.includes(`api.${method}(`));
	}
	assert(app.includes('"stubs"'));
	assert(app.includes("openStubs"));
	assert(app.includes("vocabulary.stubList"));
	assert(app.includes("vocabulary.stubContext"));
	assert(app.includes("vocabulary.backlink"));
	assertMatch(app, /api\.createStub\("stub-list"\)/);
	assertMatch(app, /api\.updateUnplacedWorkText\(entry\.workId, text\)/);
	assertMatch(app, /disabled=\{!entry\.hasText\}/);
	assert(app.includes("entry.backlinks"));
	assert(app.includes("stubCreatedViaLabel"));
	assertFalse(/直接|store\./.test(app));
});

Deno.test("Stub resolution is never triggered implicitly by text editing", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	const updateStubText = app.match(/async function updateStubText[\s\S]*?\n\t\}/)?.[0] ?? "";
	assert(updateStubText.includes("api.updateUnplacedWorkText("));
	assertFalse(
		updateStubText.includes("resolveStub"),
		"Editing the body must not implicitly resolve a Stub",
	);
	assertMatch(app, /onclick=\{\(\) => resolveStubEntry\(entry\.workId\)\}/);
});
