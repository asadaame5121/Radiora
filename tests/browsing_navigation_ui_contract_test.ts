import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("App exposes browsing scope, breadcrumb, and recent-edit navigation", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const outlineView = await Deno.readTextFile(
		new URL("../src/ui/OutlineView.svelte", import.meta.url),
	);
	const outlineRowItem = await Deno.readTextFile(
		new URL("../src/ui/OutlineRowItem.svelte", import.meta.url),
	);
	const controller = await Deno.readTextFile(
		new URL("../src/ui/navigation_controller.svelte.ts", import.meta.url),
	);

	assert(app.includes("createNavigationController"));
	assert(app.includes("navigationController.projectBrowsing(snapshot)"));
	assert(app.includes("$derived(navigationController.browsingLocation)"));
	assert(app.includes("$derived(navigationController.browsingPane)"));
	assert(outlineView.includes("vocabulary.breadcrumb"));
	assert(outlineView.includes("vocabulary.hoist"));
	assert(outlineView.includes("onClearHoist"));
	assert(outlineRowItem.includes("vocabulary.work"));
	assert(app.includes("recentEditedItems"));
	assert(app.includes("openRecentItem"));
	assert(app.includes("outlineContextTitle"));
	assertFalse(app.includes("goBrowsingHistory(-1)"));
	assertFalse(app.includes("goBrowsingHistory(1)"));
	assertFalse(app.includes("createBrowsingNavigationState("));
	assertFalse(app.includes("projectBrowsingOutline("));

	assert(controller.includes("createBrowsingNavigationState("));
	assert(controller.includes("projectBrowsingOutline("));
	assert(controller.includes("openBrowsingPane("));
	assert(controller.includes("activateBrowsingPane("));
});

Deno.test("App delegates browsing transitions without persisting expansion or placement", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const selection = await Deno.readTextFile(
		new URL("../src/ui/occurrence_selection_workspace.ts", import.meta.url),
	);
	const controller = await Deno.readTextFile(
		new URL("../src/ui/navigation_controller.svelte.ts", import.meta.url),
	);
	const selectItem = app.slice(
		app.indexOf("function selectItem"),
		app.indexOf("async function loadEmergence"),
	);
	const browsingControls = app.slice(
		app.indexOf("function selectOccurrence"),
		app.indexOf("async function createRoot"),
	);

	assert(selectItem.includes("expandedIds: ancestorIds"));
	assert(selectItem.includes("screenNavigation.navigate"));
	assertFalse(selectItem.includes("api.setCollapsed"));
	assert(browsingControls.includes("selectionWorkspace.select(id, afterSelection)"));
	assert(browsingControls.includes("selectionWorkspace.switchPane(paneId)"));
	assert(
		selection.includes("browseToOutlineOccurrence(this.ports.outline.browsing(), snapshot, id)"),
	);
	assert(selection.includes("activateBrowsingPane(state, paneId)"));
	assert(browsingControls.includes("navigationController.addBrowsingPane()"));
	const hoistSelected = browsingControls.slice(
		browsingControls.indexOf("function hoistSelected"),
		browsingControls.indexOf("function clearHoist"),
	);
	assert(hoistSelected.includes("transientExpandedIds"));
	assert(hoistSelected.includes("selectedId"));
	assert(hoistSelected.includes("selectionWorkspace.setHoist(selectedId)"));
	assertFalse(hoistSelected.includes("setCollapsed"));
	assertFalse(browsingControls.includes("api."));
	assertFalse(browsingControls.includes("browseToOutlineOccurrence("));
	assertFalse(browsingControls.includes("reconcileBrowsingState("));
	assertFalse(browsingControls.includes("parentId ="));
	assertFalse(browsingControls.includes("orderKey ="));
	assertFalse(browsingControls.includes("collapsed ="));

	assert(controller.includes("browseToOutlineOccurrence(browsing, snapshot, occurrenceId)"));
	assert(controller.includes("reconcileBrowsingState(browsing, snapshot)"));
	assert(controller.includes("setBrowsingHoist(browsing, occurrenceId)"));
	assertFalse(controller.includes("api."));
});

Deno.test("reload delegates focus publication to the Outline owner with both receipts", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assertMatch(app, /return outlineController\.reload\(\{/);
	assertMatch(app, /selectionReceipt: \(\) => selectionWorkspace\.currentReceipt\(\)/);
	assertMatch(
		app,
		/focus: \(id, reloadCurrent\) => selectOccurrence\(id, \(selectionCurrent\) => requestFocus\(id, undefined, \(\) => reloadCurrent\(\) && selectionCurrent\(\)\)\)/,
	);
});
