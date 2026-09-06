import { expect, type Page, test } from "@playwright/test";

function outlineRow(page: Page, id: string) {
	return page.getByRole("treeitem").filter({ has: page.locator(`textarea[data-item-id="${id}"]`) });
}

test.beforeEach(async ({ page }) => {
	const items = ["mock-2", "mock-7", "mock-8"].map((id, index) => ({
		id,
		workId: id,
		text: id,
		parentId: index === 0 ? null : "mock-2",
		orderKey: index,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: id },
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z",
	}));
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: [], knots: [], stashItemIds: [] } },
		}));
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(outlineRow(page, "mock-7")).toBeVisible();
});

test("drop sends the source occurrence and restores its focus after dragend during persistence", async ({ page }) => {
	const moves: unknown[] = [];
	const pendingMove = Promise.withResolvers<void>();
	await page.route("**/api/rpc/moveItem", async (route) => {
		moves.push(route.request().postDataJSON());
		await pendingMove.promise;
		await route.fulfill({ json: { result: null } });
	});
	const source = outlineRow(page, "mock-7");
	const target = outlineRow(page, "mock-8");
	try {
		await source.dispatchEvent("dragstart");
		await expect(source).toHaveClass(/dragging/);
		await target.dispatchEvent("drop");
		await source.dispatchEvent("dragend");
		await expect.poll(() => moves).toEqual([
			{ args: [{ id: "mock-7", parentId: "mock-2", afterId: "mock-8" }] },
		]);
		await expect(source).not.toHaveClass(/dragging/);
	} finally {
		pendingMove.resolve();
	}
	await expect(source.locator("textarea")).toBeFocused();
	await expect(source).toHaveAttribute("aria-selected", "true");
});

test("self drop and cancelled drag do not move; blank clicks respect the drag lifecycle", async ({ page }) => {
	const moves: unknown[] = [];
	await page.route("**/api/rpc/moveItem", async (route) => {
		moves.push(route.request().postDataJSON());
		await route.fulfill({ json: { result: null } });
	});
	const source = outlineRow(page, "mock-7");
	await source.getByRole("button", { name: "項目を選択", exact: true }).click();
	await source.locator("textarea").focus();
	await expect(source).toHaveAttribute("aria-selected", "true");
	await source.dispatchEvent("dragstart");
	await source.dispatchEvent("mousedown", { button: 0 });
	await expect(source).toHaveAttribute("aria-selected", "true");
	await source.dispatchEvent("drop");
	await source.dispatchEvent("dragend");
	await expect(source).not.toHaveClass(/dragging/);
	await outlineRow(page, "mock-8").dispatchEvent("drop");
	await source.dispatchEvent("mousedown", { button: 2 });
	await expect(source).toHaveAttribute("aria-selected", "true");
	await source.dispatchEvent("mousedown", { button: 0 });
	await expect(source).toHaveAttribute("aria-selected", "false");
	await expect(source.locator("textarea")).not.toBeFocused();
	expect(moves).toEqual([]);
});

test("native drag reports a failed move and clears drag state", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/api/rpc/moveItem", (route) =>
		route.fulfill({
			status: 500,
			json: { message: "Move persistence failed" },
		}));
	const source = outlineRow(page, "mock-7");
	await source.dragTo(outlineRow(page, "mock-8"));
	await expect(page.getByText("Move persistence failed")).toBeVisible();
	await expect(source).not.toHaveClass(/dragging/);
	await source.getByRole("button", { name: "項目を選択", exact: true }).click();
	await source.locator("textarea").focus();
	await page.getByRole("tree").dispatchEvent("mousedown", { button: 0 });
	await expect(source).toHaveAttribute("aria-selected", "false");
	expect(errors).toEqual([]);
});

test("leaving Outline cancels a drag even without a dragend event", async ({ page }) => {
	const moves: unknown[] = [];
	await page.route("**/api/rpc/moveItem", async (route) => {
		moves.push(route.request().postDataJSON());
		await route.fulfill({ json: { result: null } });
	});
	await outlineRow(page, "mock-7").dispatchEvent("dragstart");
	await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "Option",
		exact: true,
	}).click();
	await expect(page.getByRole("heading", { name: "Option", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "アウトライン", exact: true }).click();
	const source = outlineRow(page, "mock-7");
	await expect(source).not.toHaveClass(/dragging/);
	await outlineRow(page, "mock-8").dispatchEvent("drop");
	await source.getByRole("button", { name: "項目を選択", exact: true }).click();
	await page.getByRole("tree").dispatchEvent("mousedown", { button: 0 });
	await expect(source).toHaveAttribute("aria-selected", "false");
	expect(moves).toEqual([]);
});
