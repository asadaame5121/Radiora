import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("App exposes browsing scope, breadcrumb, and recent-edit navigation", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	assert(app.includes("createBrowsingNavigationState"));
	assert(app.includes("projectBrowsingOutline"));
	assert(app.includes("vocabulary.hoist"));
	assert(app.includes("vocabulary.breadcrumb"));
	assert(app.includes("recentEditedItems"));
	assert(app.includes("openRecentItem"));
	assert(app.includes("outlineContextTitle"));
	assertFalse(app.includes("goBrowsingHistory(-1)"));
	assertFalse(app.includes("goBrowsingHistory(1)"));
	assert(app.includes("openBrowsingPane"));
	assert(app.includes("activateBrowsingPane"));
});

Deno.test("App browsing routes do not persist expansion or placement", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const selectItem = app.slice(
		app.indexOf("async function selectItem"),
		app.indexOf("async function loadEmergence"),
	);
	const browsingControls = app.slice(
		app.indexOf("function selectOccurrence"),
		app.indexOf("async function createRoot"),
	);

	assert(selectItem.includes("transientExpandedIds = ancestorIds"));
	assertFalse(selectItem.includes("api.setCollapsed"));
	assert(browsingControls.includes("browseToOutlineOccurrence"));
	assert(browsingControls.includes("reconcileBrowsingState"));
	const hoistSelected = browsingControls.slice(
		browsingControls.indexOf("function hoistSelected"),
		browsingControls.indexOf("function clearHoist"),
	);
	assert(hoistSelected.includes("transientExpandedIds"));
	assert(hoistSelected.includes("selectedId"));
	assertFalse(hoistSelected.includes("setCollapsed"));
	assertFalse(browsingControls.includes("api."));
	assertFalse(browsingControls.includes("parentId ="));
	assertFalse(browsingControls.includes("orderKey ="));
	assertFalse(browsingControls.includes("collapsed ="));
});

Deno.test("loading a focus target selects it before restoring editor focus", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const load = app.slice(
		app.indexOf("async function load"),
		app.indexOf("function selectOccurrence"),
	);

	assertMatch(
		load,
		/if \(focusId\) \{\s*selectOccurrence\(focusId\);\s*await tick\(\);\s*requestFocus\(focusId\);/,
	);
});
