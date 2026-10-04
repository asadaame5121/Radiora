import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

async function readUi(name: string): Promise<string> {
	return await Deno.readTextFile(new URL(`../src/ui/${name}`, import.meta.url));
}

Deno.test("global and selected Work lineage have separate UI responsibilities", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await readUi("GlobalLineage.svelte");
	const displayed = await readUi("GlobalLineageDisplayedPane.svelte");
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
	assert(displayed.includes("projection.promotedBranches"));
	assert(work.includes("projection.revisions"));
	assert(work.includes("projection.branches"));
	assert(work.includes("revision.parentRevisionIds"));
	assert(work.includes("← アウトラインに戻る"));
	assert(app.includes('onBack={() => { void screenNavigation.navigate({ view: "outline" }); }}'));
	assertFalse(work.includes("PhylogeneticTree"));
	assertFalse(work.includes("semanticLink"));
});

Deno.test("global tree clears selection, opens real nodes, and restores its projection", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await readUi("GlobalLineage.svelte");
	const tree = await Deno.readTextFile(
		new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
	);

	const pointer = await readUi("tree_pointer_adapter.ts");
	assert(pointer.includes('addEventListener("click", click)'));
	assert(tree.includes("onSelect(null)"));
	assert(tree.includes("ondblclick={(event) => handleNodeDoubleClick(event, node)}"));
	assert(tree.includes("if (node.aggregate) return"));
	const owner = await readUi("tree_controller.svelte.ts");
	assert(owner.includes("loadTreeProjectionPreference(preferences.projectionStorage)"));
	assert(owner.includes("saveTreeProjectionPreference(next, this.preferences.projectionStorage)"));
	assertFalse(tree.includes("loadTreeProjectionPreference"));
	assertFalse(tree.includes("saveTreeProjectionPreference"));
	assert(global.includes("projection={projectionPreference}"));
	assert(app.includes("projectionPreference={tree.projectionPreference}"));
	assert(global.includes("{onOpen}"));
	assert(app.includes("function openTreeOccurrence"));
	assert(app.includes("openOutlineOccurrence(id"));
	assert(app.includes('void screenNavigation.navigate({ view: "outline" })'));
	assert(
		app.includes('screenNavigation.navigate({ view: "outline", occurrenceId: id, expandedIds })'),
	);
});

Deno.test("global tree preserves Work-based selection and closure highlighting", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const global = await readUi("GlobalLineage.svelte");
	const tree = await readUi("PhylogeneticTree.svelte");

	assert(app.includes("selectedWorkId={selectedItem?.workId ?? null}"));
	assert(global.includes("selectedWorkId = null"));
	assert(global.includes("{selectedWorkId}"));
	assert(tree.includes("resolveTreeSelectionId(snapshot, selectedId, selectedWorkId)"));
	assert(tree.includes("buildTreeHighlightSet(snapshot, selectionId, hoveredId)"));
	assert(tree.includes("highlightedIds.has(id)"));
});

Deno.test("cluster inspection opens the sidebar without moving the central camera", async () => {
	const tree = await Deno.readTextFile(
		new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
	);
	const global = await Deno.readTextFile(
		new URL("../src/ui/GlobalLineage.svelte", import.meta.url),
	);
	const sidebar = await readUi("GlobalLineageSidebar.svelte");

	assert(tree.includes("onInspectCluster?.(node)"));
	assertMatch(
		tree,
		/Inspect cluster[\s\S]*must not move the central camera|Inspecting a cluster must not move the central camera/,
	);
	assert(global.includes("onInspectCluster={handleInspectCluster}"));
	assert(global.includes('activeTab = "inspect"'));
	assert(sidebar.includes("切り出し"));
	assert(sidebar.includes("表示中"));
	assert(sidebar.includes("フィルター"));
});

Deno.test("the inspection pane lists members, internal links, stubs, and a zoom-out action", async () => {
	const global = await readUi("GlobalLineage.svelte");
	const inspect = await readUi("GlobalLineageInspectPane.svelte");
	const tree = await Deno.readTextFile(
		new URL("../src/ui/PhylogeneticTree.svelte", import.meta.url),
	);

	assert(inspect.includes("clusterMembers"));
	assert(inspect.includes("buildLaneOrder"));
	assert(inspect.includes("internalLinks"));
	assert(inspect.includes("externalStubs"));
	assert(inspect.includes("中央で拡大"));
	assert(inspect.includes("onZoomToCluster(inspectCluster?.bounds)"));
	assert(global.includes("treeElement?.zoomToBounds(bounds)"));
	assert(tree.includes("export function zoomToBounds"));
	assert(inspect.includes("→ 外部"));
	assert(inspect.includes("member.id === selectedId"));
	assert(inspect.includes("onOpen(member.id)"));
});

Deno.test("filter changes reload the projection and preserve only persisted settings", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const filter = await readUi("GlobalLineageFilterPane.svelte");

	assert(filter.includes("孤立"));
	assert(filter.includes("すべて選択"));
	assert(filter.includes("すべて解除"));
	assert(filter.includes("onFilterChange({ ...filter, includeIsolated:"));
	assert(filter.includes("onFilterChange({ ...filter, linkTypes })"));
	const owner = await readUi("tree_controller.svelte.ts");
	assertFalse(app.includes("loadTreeFilterPreference"));
	assertFalse(app.includes("saveTreeFilterPreference"));
	assert(owner.includes("loadTreeFilterPreference(preferences.filterStorage)"));
	assert(owner.includes("saveTreeFilterPreference(this._filter, this.preferences.filterStorage)"));
	assert(owner.includes("includeWorkIds: id ? [id] : []"));
	assert(app.includes("treeRequest.result"));
});

Deno.test("selection changes refresh the exception projection while the tree view is open", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	assert(app.includes("tree.filterKey()"));
	assert(app.includes("tree.needsRefresh(key)"));
	assertMatch(
		app,
		/viewMode !== "globalLineage"[\s\S]*?tree\.filterKey\(\)[\s\S]*?void tree\.refresh\(\)/,
	);
});

Deno.test("global lineage requests are generation-guarded against out-of-order responses", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	const owner = await readUi("tree_controller.svelte.ts");
	assertFalse(app.includes("globalLineageRequest"));
	assert(owner.includes("private generation = 0"));
	assert(owner.includes("generation === this.generation && key === this.filterKey()"));
	assert(app.includes("treeRequest.publish(nextGlobalLineage)"));
	assert(app.includes("treeRequest.cancel()"));
});

Deno.test("filter state closes a vanished cluster and shows the filter tab", async () => {
	const global = await readUi("GlobalLineage.svelte");

	assert(global.includes("inspectCluster.itemIds.every((id) =>"));
	assert(global.includes("projection.snapshot.items.some((item) => item.id === id)"));
	assert(global.includes("inspectCluster = null"));
	assert(global.includes('activeTab = "filter"'));
});

Deno.test("the sidebar drawer supports Escape, close, backdrop, and focus return", async () => {
	const sidebar = await readUi("GlobalLineageSidebar.svelte");

	assert(sidebar.includes('event.key === "Escape" && drawerOpen'));
	assert(sidebar.includes("closeDrawer()"));
	assert(sidebar.includes("sidebar-backdrop"));
	assert(sidebar.includes("sidebar-close"));
	assert(sidebar.includes("lastFocused.focus"));
	assert(sidebar.includes("max-width: 1000px"));
	assert(sidebar.includes("min(360px, 85vw)"));
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
