import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("global and selected Work lineage have separate UI responsibilities", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);
	const work = await Deno.readTextFile(
		new URL("../src/ui/WorkLineage.svelte", import.meta.url),
	);

	for (const view of ['"outline"', '"today"', '"unplaced"', '"globalLineage"', '"workLineage"']) {
		assert(app.includes(view));
	}
	assert(app.includes("<GlobalLineage"));
	assert(app.includes("<WorkLineage"));
	assert(global.includes("<PhylogeneticTree"));
	assert(global.includes("{onOpen}"));
	assert(global.includes("projection.promotedBranches"));
	assert(work.includes("projection.revisions"));
	assert(work.includes("projection.branches"));
	assert(work.includes("revision.parentRevisionIds"));
	assertFalse(work.includes("PhylogeneticTree"));
	assertFalse(work.includes("semanticLink"));
});

Deno.test("global tree clears selection, opens real nodes, and restores its projection", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);
	const tree = await Deno.readTextFile(
		new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
	);

	assert(tree.includes('addEventListener("click", handleCanvasClick)'));
	assert(tree.includes("onSelect(null)"));
	assert(tree.includes("ondblclick={(event) => handleNodeDoubleClick(event, node)}"));
	assert(tree.includes("if (node.aggregate) return"));
	assert(tree.includes("loadTreeProjectionPreference()"));
	assert(tree.includes("saveTreeProjectionPreference(next)"));
	assert(global.includes("{onOpen}"));
	assert(app.includes("async function openTreeOccurrence"));
	assert(app.includes('viewMode = "outline"'));
	assert(app.includes("requestFocus(id)"));
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
