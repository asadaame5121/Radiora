import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
async function readUi(name: string): Promise<string> {
	return await readFile(new URL(`../../../src/ui/${name}`, import.meta.url), "utf8");
}

test("global and selected Work lineage have separate UI responsibilities", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const global = await readUi("GlobalLineage.svelte");
	const displayed = await readUi("GlobalLineageDisplayedPane.svelte");
	const work = await readFile(
		new URL("../../../src/ui/WorkLineage.svelte", import.meta.url),
		"utf8",
	);

	for (const view of ['"outline"', '"today"', '"unplaced"', '"globalLineage"', '"workLineage"']) {
		expect(app.includes(view)).toBeTruthy();
	}
	expect(app.includes("<GlobalLineage")).toBeTruthy();
	expect(app.includes("<WorkLineage")).toBeTruthy();
	expect(global.includes("<PhylogeneticTree")).toBeTruthy();
	expect(global.includes("{onOpen}")).toBeTruthy();
	expect(displayed.includes("projection.promotedBranches")).toBeTruthy();
	expect(work.includes("projection.revisions")).toBeTruthy();
	expect(work.includes("projection.branches")).toBeTruthy();
	expect(work.includes("revision.parentRevisionIds")).toBeTruthy();
	expect(work.includes("← アウトラインに戻る")).toBeTruthy();
	expect(
		app.includes('onBack={() => { void screenNavigation.navigate({ view: "outline" }); }}'),
	).toBeTruthy();
	expect(work.includes("PhylogeneticTree")).toBe(false);
	expect(work.includes("semanticLink")).toBe(false);
});

test("global tree clears selection, opens real nodes, and restores its projection", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const global = await readUi("GlobalLineage.svelte");
	const tree = await readFile(
		new URL("../../../src/ui/PhylogeneticTree.svelte", import.meta.url),
		"utf8",
	);

	const pointer = await readUi("tree_pointer_adapter.ts");
	expect(pointer.includes('addEventListener("click", click)')).toBeTruthy();
	expect(tree.includes("onSelect(null)")).toBeTruthy();
	expect(tree.includes("ondblclick={(event) => handleNodeDoubleClick(event, node)}")).toBeTruthy();
	expect(tree.includes("if (node.aggregate) return")).toBeTruthy();
	const owner = await readUi("tree_controller.svelte.ts");
	expect(
		owner.includes("loadTreeProjectionPreference(preferences.projectionStorage)"),
	).toBeTruthy();
	expect(
		owner.includes("saveTreeProjectionPreference(next, this.preferences.projectionStorage)"),
	).toBeTruthy();
	expect(tree.includes("loadTreeProjectionPreference")).toBe(false);
	expect(tree.includes("saveTreeProjectionPreference")).toBe(false);
	expect(global.includes("projection={projectionPreference}")).toBeTruthy();
	expect(app.includes("projectionPreference={tree.projectionPreference}")).toBeTruthy();
	expect(global.includes("{onOpen}")).toBeTruthy();
	expect(app.includes("function openTreeOccurrence")).toBeTruthy();
	expect(app.includes("openOutlineOccurrence(id")).toBeTruthy();
	expect(app.includes('void screenNavigation.navigate({ view: "outline" })')).toBeTruthy();
	expect(
		app.includes('screenNavigation.navigate({ view: "outline", occurrenceId: id, expandedIds })'),
	).toBeTruthy();
});

test("global tree preserves Work-based selection and closure highlighting", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const global = await readUi("GlobalLineage.svelte");
	const tree = await readUi("PhylogeneticTree.svelte");

	expect(app.includes("selectedWorkId={selectedItem?.workId ?? null}")).toBeTruthy();
	expect(global.includes("selectedWorkId = null")).toBeTruthy();
	expect(global.includes("{selectedWorkId}")).toBeTruthy();
	expect(
		tree.includes("resolveTreeSelectionId(snapshot, selectedId, selectedWorkId)"),
	).toBeTruthy();
	expect(tree.includes("buildTreeHighlightSet(snapshot, selectionId, hoveredId)")).toBeTruthy();
	expect(tree.includes("highlightedIds.has(id)")).toBeTruthy();
});

test("cluster inspection opens the sidebar without moving the central camera", async () => {
	const tree = await readFile(
		new URL("../../../src/ui/PhylogeneticTree.svelte", import.meta.url),
		"utf8",
	);
	const global = await readFile(
		new URL("../../../src/ui/GlobalLineage.svelte", import.meta.url),
		"utf8",
	);
	const sidebar = await readUi("GlobalLineageSidebar.svelte");

	expect(tree.includes("onInspectCluster?.(node)")).toBeTruthy();
	expect(tree).toMatch(
		/Inspect cluster[\s\S]*must not move the central camera|Inspecting a cluster must not move the central camera/,
	);
	expect(global.includes("onInspectCluster={handleInspectCluster}")).toBeTruthy();
	expect(global.includes('activeTab = "inspect"')).toBeTruthy();
	expect(sidebar.includes("切り出し")).toBeTruthy();
	expect(sidebar.includes("表示中")).toBeTruthy();
	expect(sidebar.includes("フィルター")).toBeTruthy();
});

test("the inspection pane lists members, internal links, stubs, and a zoom-out action", async () => {
	const global = await readUi("GlobalLineage.svelte");
	const inspect = await readUi("GlobalLineageInspectPane.svelte");
	const tree = await readFile(
		new URL("../../../src/ui/PhylogeneticTree.svelte", import.meta.url),
		"utf8",
	);

	expect(inspect.includes("clusterMembers")).toBeTruthy();
	expect(inspect.includes("buildLaneOrder")).toBeTruthy();
	expect(inspect.includes("internalLinks")).toBeTruthy();
	expect(inspect.includes("externalStubs")).toBeTruthy();
	expect(inspect.includes("中央で拡大")).toBeTruthy();
	expect(inspect.includes("onZoomToCluster(inspectCluster?.bounds)")).toBeTruthy();
	expect(global.includes("treeElement?.zoomToBounds(bounds)")).toBeTruthy();
	expect(tree.includes("export function zoomToBounds")).toBeTruthy();
	expect(inspect.includes("→ 外部")).toBeTruthy();
	expect(inspect.includes("member.id === selectedId")).toBeTruthy();
	expect(inspect.includes("onOpen(member.id)")).toBeTruthy();
});

test("filter changes reload the projection and preserve only persisted settings", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const filter = await readUi("GlobalLineageFilterPane.svelte");

	expect(filter.includes("孤立")).toBeTruthy();
	expect(filter.includes("すべて選択")).toBeTruthy();
	expect(filter.includes("すべて解除")).toBeTruthy();
	expect(filter.includes("onFilterChange({ ...filter, includeIsolated:")).toBeTruthy();
	expect(filter.includes("onFilterChange({ ...filter, linkTypes })")).toBeTruthy();
	const owner = await readUi("tree_controller.svelte.ts");
	expect(app.includes("loadTreeFilterPreference")).toBe(false);
	expect(app.includes("saveTreeFilterPreference")).toBe(false);
	expect(owner.includes("loadTreeFilterPreference(preferences.filterStorage)")).toBeTruthy();
	expect(
		owner.includes("saveTreeFilterPreference(this._filter, this.preferences.filterStorage)"),
	).toBeTruthy();
	expect(owner.includes("includeWorkIds: id ? [id] : []")).toBeTruthy();
	expect(app.includes("tree.prepareRefresh(current, required)")).toBeTruthy();
	const outline = await readUi("outline_controller.svelte.ts");
	expect(outline.includes("tree.result")).toBeTruthy();
});

test("selection changes refresh the exception projection while the tree view is open", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");

	expect(app.includes("tree.filterKey()")).toBeTruthy();
	expect(app.includes("tree.needsRefresh(key)")).toBeTruthy();
	expect(app).toMatch(
		/viewMode !== "globalLineage"[\s\S]*?tree\.filterKey\(\)[\s\S]*?void tree\.refresh\(\)/,
	);
});

test("global lineage requests are generation-guarded against out-of-order responses", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");

	const owner = await readUi("tree_controller.svelte.ts");
	expect(app.includes("globalLineageRequest")).toBe(false);
	expect(owner.includes("private generation = 0")).toBeTruthy();
	expect(owner.includes("generation === this.generation && key === this.filterKey()")).toBeTruthy();
	expect(app.includes("tree.prepareRefresh(current, required)")).toBeTruthy();
	const outline = await readUi("outline_controller.svelte.ts");
	expect(outline.includes("tree.publish()")).toBeTruthy();
	expect(outline.includes("tree.cancel()")).toBeTruthy();
});

test("filter state closes a vanished cluster and shows the filter tab", async () => {
	const global = await readUi("GlobalLineage.svelte");

	expect(global.includes("inspectCluster.itemIds.every((id) =>")).toBeTruthy();
	expect(global.includes("projection.snapshot.items.some((item) => item.id === id)")).toBeTruthy();
	expect(global.includes("inspectCluster = null")).toBeTruthy();
	expect(global.includes('activeTab = "filter"')).toBeTruthy();
});

test("the sidebar drawer supports Escape, close, backdrop, and focus return", async () => {
	const sidebar = await readUi("GlobalLineageSidebar.svelte");

	expect(sidebar.includes('event.key === "Escape" && drawerOpen')).toBeTruthy();
	expect(sidebar.includes("closeDrawer()")).toBeTruthy();
	expect(sidebar.includes("sidebar-backdrop")).toBeTruthy();
	expect(sidebar.includes("sidebar-close")).toBeTruthy();
	expect(sidebar.includes("lastFocused.focus")).toBeTruthy();
	expect(sidebar.includes("max-width: 1000px")).toBeTruthy();
	expect(sidebar.includes("min(360px, 85vw)")).toBeTruthy();
});

test("filter results show the displayed and total Work counts in the tree", async () => {
	const global = await readFile(
		new URL("../../../src/ui/GlobalLineage.svelte", import.meta.url),
		"utf8",
	);

	expect(global.includes("projection.filteredWorkCount")).toBeTruthy();
	expect(global.includes("projection.totalWorkCount")).toBeTruthy();
	expect(global.includes("activeConditionCount")).toBeTruthy();
	expect(global.includes("条件")).toBeTruthy();
});
test("lineage UI labels come from UiVocabulary", async () => {
	const global = await readFile(
		new URL("../../../src/ui/GlobalLineage.svelte", import.meta.url),
		"utf8",
	);
	const work = await readFile(
		new URL("../../../src/ui/WorkLineage.svelte", import.meta.url),
		"utf8",
	);

	for (const component of [global, work]) {
		expect(component.includes("useUiVocabulary()")).toBeTruthy();
		expect(/実身|化身/.test(component)).toBe(false);
	}
});
