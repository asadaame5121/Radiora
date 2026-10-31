import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Today UI keeps created and updated projections separate without creating outline parents", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const view = await readFile(new URL("../../../src/ui/TodayView.svelte", import.meta.url), "utf8");
	const service = await readFile(
		new URL("../../../src/services/date_projection.ts", import.meta.url),
		"utf8",
	);
	const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");
	expect(app.includes('viewMode === "today"')).toBeTruthy();
	expect(app.includes("<TodayView")).toBeTruthy();
	expect(view.includes("この期間に作成")).toBeTruthy();
	expect(view.includes("この期間に更新")).toBeTruthy();
	expect(app.includes("api.projectDates")).toBeTruthy();
	expect(view.includes(".date-entry")).toBeTruthy();
	expect(view.includes("background: var(--surface-raised) !important")).toBeTruthy();
	const openDateEntry = app.slice(
		app.indexOf("async function openDateEntry"),
		app.indexOf("async function performAddBookmark"),
	);
	expect(openDateEntry.includes("openNavigationTarget")).toBeTruthy();
	expect(openDateEntry.includes("selectItem(")).toBe(false);
	expect(openDateEntry.includes("setCollapsed")).toBe(false);
	expect(view.includes("前日")).toBeTruthy();
	expect(view.includes("翌日")).toBeTruthy();
	expect(view.includes("週")).toBeTruthy();
	expect(view.includes('type="date"')).toBeTruthy();
	expect(view.includes("終了（含まない）")).toBeTruthy();
	expect(service.includes("this.store.listWorks()")).toBeTruthy();
	expect(service.includes("this.store.listItems()")).toBeTruthy();
	expect(service.includes("createItem(")).toBe(false);
	expect(service.includes("createOccurrence(")).toBe(false);
	expect(service.includes("updateOccurrence(")).toBe(false);
});
