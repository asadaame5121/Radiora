import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("global and selected Work lineage have separate UI responsibilities", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);
	const work = await Deno.readTextFile(
		new URL("../src/ui/WorkLineage.svelte", import.meta.url),
	);

	assert(app.includes('type ViewMode = "outline" | "globalLineage" | "workLineage"'));
	assert(app.includes("<GlobalLineage"));
	assert(app.includes("<WorkLineage"));
	assert(global.includes("<PhylogeneticTree"));
	assert(global.includes("projection.promotedBranches"));
	assert(work.includes("projection.revisions"));
	assert(work.includes("projection.branches"));
	assert(work.includes("revision.parentRevisionIds"));
	assertFalse(work.includes("PhylogeneticTree"));
	assertFalse(work.includes("semanticLink"));
});

Deno.test("lineage UI labels come from UiVocabulary", async () => {
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);
	const work = await Deno.readTextFile(
		new URL("../src/ui/WorkLineage.svelte", import.meta.url),
	);

	for (const component of [global, work]) {
		assert(component.includes("useUiVocabulary()"));
		assertFalse(/実身|化身/.test(component));
	}
});
