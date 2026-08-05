import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

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

Deno.test("cluster inspection opens the sidebar without moving the central camera", async () => {
	const tree = await Deno.readTextFile(
		new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
	);
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);

	assert(tree.includes("onInspectCluster?.(node)"));
	assertMatch(
		tree,
		/Inspect cluster[\s\S]*must not move the central camera|Inspecting a cluster must not move the central camera/,
	);
	assert(global.includes("onInspectCluster={handleInspectCluster}"));
	assert(global.includes('activeTab = "inspect"'));
	assert(global.includes("切り出し"));
	assert(global.includes("表示中"));
	assert(global.includes("フィルター"));
});

Deno.test("the inspection pane lists members, internal links, stubs, and a zoom-out action", async () => {
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);
	const tree = await Deno.readTextFile(
		new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
	);

	assert(global.includes("clusterMembers"));
	assert(global.includes("buildLaneOrder"));
	assert(global.includes("internalLinks"));
	assert(global.includes("externalStubs"));
	assert(global.includes("中央で拡大"));
	assert(global.includes("treeElement?.zoomToBounds(inspectCluster.bounds)"));
	assert(tree.includes("export function zoomToBounds"));
	assert(global.includes("→ 外部"));
	assert(global.includes("member.id === selectedId"));
	assert(global.includes("onOpen(member.id)"));
});

Deno.test("filter changes reload the projection and preserve only persisted settings", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);

	assert(global.includes("孤立"));
	assert(global.includes("すべて選択"));
	assert(global.includes("すべて解除"));
	assert(global.includes("onFilterChange({ ...filter, includeIsolated })"));
	assert(global.includes("onFilterChange({ ...filter, linkTypes })"));
	assert(app.includes("loadTreeFilterPreference()"));
	assert(app.includes("saveTreeFilterPreference(treeFilter)"));
	assert(app.includes("api.listGlobalLineage(activeGlobalLineageFilter)"));
	assert(app.includes("includeWorkIds: selectedItem ? [selectedItem.workId] : []"));
});

Deno.test("selection changes refresh the exception projection while the tree view is open", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	assert(app.includes("lastLoadedGlobalLineageFilterKey"));
	assert(app.includes("globalLineageFilterKey()"));
	assertMatch(
		app,
		/viewMode !== "globalLineage"[\s\S]*?globalLineageFilterKey\(\)[\s\S]*?void loadGlobalLineage\(\)/,
	);
});

Deno.test("global lineage requests are generation-guarded against out-of-order responses", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	assert(app.includes("let globalLineageRequest = 0"));
	assert(app.includes("const request = ++globalLineageRequest"));
	assert(app.includes("request !== globalLineageRequest"));
});

Deno.test("filter state closes a vanished cluster and shows the filter tab", async () => {
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);

	assert(global.includes("inspectCluster.itemIds.every((id) => itemById.get(id) !== undefined)"));
	assert(global.includes("inspectCluster = null"));
	assert(global.includes('activeTab = "filter"'));
});

Deno.test("the sidebar drawer supports Escape, close, backdrop, and focus return", async () => {
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);

	assert(global.includes('event.key === "Escape" && drawerOpen'));
	assert(global.includes("closeDrawer()"));
	assert(global.includes("sidebar-backdrop"));
	assert(global.includes("sidebar-close"));
	assert(global.includes("lastFocused.focus"));
	assert(global.includes("max-width: 1000px"));
	assert(global.includes("min(360px, 85vw)"));
});

Deno.test("filter results show the displayed and total Work counts in the tree", async () => {
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);

	assert(global.includes("projection.filteredWorkCount"));
	assert(global.includes("projection.totalWorkCount"));
	assert(global.includes("activeConditionCount"));
	assert(global.includes("条件"));
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
