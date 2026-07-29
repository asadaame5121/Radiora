import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("Today UI keeps created and updated projections separate without creating outline parents", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const service = await Deno.readTextFile(
		new URL("../src/services/date_projection.ts", import.meta.url),
	);
	assert(app.includes('viewMode === "today"'));
	assert(app.includes("この期間に作成"));
	assert(app.includes("この期間に更新"));
	assert(app.includes("api.projectDates"));
	const openDateEntry = app.slice(
		app.indexOf("async function openDateEntry"),
		app.indexOf("async function loadRevisions"),
	);
	assert(openDateEntry.includes("openNavigationTarget"));
	assertFalse(openDateEntry.includes("selectItem("));
	assertFalse(openDateEntry.includes("setCollapsed"));
	assert(app.includes("前日"));
	assert(app.includes("翌日"));
	assert(app.includes("週"));
	assert(app.includes('type="date"'));
	assert(app.includes("終了（含まない）"));
	assert(service.includes("this.store.listWorks()"));
	assert(service.includes("this.store.listItems()"));
	assertFalse(service.includes("createItem("));
	assertFalse(service.includes("createOccurrence("));
	assertFalse(service.includes("updateOccurrence("));
});
