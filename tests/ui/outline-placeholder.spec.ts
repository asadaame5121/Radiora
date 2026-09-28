import { expect, type Page, test } from "@playwright/test";

function outlineRow(page: Page, id: string) {
	return page.getByRole("treeitem").filter({ has: page.locator(`textarea[data-item-id="${id}"]`) });
}

test("empty editor displays a single placeholder without duplicate overlay on focus", async ({ page }) => {
	const items = [{
		id: "empty-item",
		workId: "empty-item",
		text: "",
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "empty-item" },
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z",
	}];
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: [], knots: [], stashItemIds: [] } },
		}));
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const row = outlineRow(page, "empty-item");
	await expect(row).toBeVisible();

	const editorHost = row.locator(".markdown-editor-host");
	const placeholderEl = editorHost.locator(".overtype-placeholder");
	const textarea = editorHost.locator("textarea");

	// In preview mode (initial/blur), overtype-placeholder element is visible and textarea placeholder is null
	await expect(placeholderEl).toHaveCount(1);
	await expect(placeholderEl).toBeVisible();
	const initialTextareaPlaceholder = await textarea.getAttribute("placeholder");
	expect(initialTextareaPlaceholder).toBeNull();

	// Click to focus (enters plain edit mode)
	await editorHost.click();
	await expect(textarea).toBeFocused();

	// In edit mode, the single placeholder element must be visible and the textarea must not double-render its native placeholder attribute
	await expect(placeholderEl).toBeVisible();
	const textareaPlaceholder = await textarea.getAttribute("placeholder");
	expect(textareaPlaceholder).toBeNull();

	await page.screenshot({ path: "reports/empty-editor-focused-fixed.png" });
});
