import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("Today UI keeps created and updated projections separate without creating outline parents", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const view = await Deno.readTextFile(new URL("../src/ui/TodayView.svelte", import.meta.url));
	const service = await Deno.readTextFile(
		new URL("../src/services/date_projection.ts", import.meta.url),
	);
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));
	assert(app.includes('viewMode === "today"'));
	assert(app.includes("<TodayView"));
	assert(view.includes("この期間に作成"));
	assert(view.includes("この期間に更新"));
	assert(app.includes("api.projectDates"));
	assert(styles.includes(".date-entry"));
	assert(styles.includes("background: var(--surface-raised) !important"));
	const openDateEntry = app.slice(
		app.indexOf("async function openDateEntry"),
		app.indexOf("async function loadRevisions"),
	);
	assert(openDateEntry.includes("openNavigationTarget"));
	assertFalse(openDateEntry.includes("selectItem("));
	assertFalse(openDateEntry.includes("setCollapsed"));
	assert(view.includes("前日"));
	assert(view.includes("翌日"));
	assert(view.includes("週"));
	assert(view.includes('type="date"'));
	assert(view.includes("終了（含まない）"));
	assert(service.includes("this.store.listWorks()"));
	assert(service.includes("this.store.listItems()"));
	assertFalse(service.includes("createItem("));
	assertFalse(service.includes("createOccurrence("));
	assertFalse(service.includes("updateOccurrence("));
});
