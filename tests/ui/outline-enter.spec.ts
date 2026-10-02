import { expect, test } from "@playwright/test";
import type { CreateItemInput, OutlineItem } from "../../src/domain/models.ts";

for (const parentId of [null, "parent"]) {
	test(`Enter inserts a sibling after B at ${parentId === null ? "root" : "child"} level`, async ({ page }) => {
		const makeItem = (id: string, parentId: string | null, orderKey: number): OutlineItem => ({
			id,
			workId: id,
			text: id,
			parentId,
			orderKey,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: id },
			createdAt: "2026-10-02T00:00:00.000Z",
			updatedAt: "2026-10-02T00:00:00.000Z",
		});
		const items = ["A", "B", "C", "D"].map((id, index) =>
			makeItem(id, parentId, (index + 1) * 1024)
		);
		if (parentId) items.unshift(makeItem(parentId, null, 1024));
		await page.route(
			"**/api/rpc/listOutline",
			(route) =>
				route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } }),
		);
		await page.route(
			"**/api/rpc/updateItemText",
			(route) => route.fulfill({ json: { result: null } }),
		);
		const creates: CreateItemInput[] = [];
		await page.route("**/api/rpc/createItem", (route) => {
			const input: CreateItemInput = route.request().postDataJSON().args[0];
			creates.push(input);
			// Storage returns the new placement last, with its persisted sibling order.
			const created = { ...makeItem("new", input.parentId, 2560), text: input.text };
			items.push(created);
			return route.fulfill({ json: { result: created } });
		});
		await page.goto("/", { waitUntil: "domcontentloaded" });
		const editor = page.locator('textarea[data-item-id="B"]');
		await page.getByRole("treeitem").filter({ has: editor }).getByRole("button", {
			name: "Markdown編集を開始",
		}).click();
		await expect(editor).toBeFocused();
		await editor.press("End");
		await editor.press("Enter");

		await expect(page.locator('textarea[data-item-id="new"]')).toBeFocused();
		expect(creates).toEqual([{ text: "", parentId, afterId: "B" }]);
		await expect(page.getByRole("treeitem").locator("textarea")).toHaveCount(items.length);
		expect(
			await page.getByRole("treeitem").locator("textarea").evaluateAll((editors) =>
				editors.map((editor) => editor.getAttribute("data-item-id"))
			),
		).toEqual([...(parentId ? [parentId] : []), "A", "B", "new", "C", "D"]);
	});
}
