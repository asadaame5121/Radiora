import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { OutlineItem } from "../../src/domain/models.ts";

test("virtual Outline exposes logical sibling counts, positions and levels", async ({ page }) => {
	const items: OutlineItem[] = Array.from({ length: 1000 }, (_, index) => ({
		id: `aria-${index}`,
		workId: `aria-${index}`,
		text: `行 ${index}`,
		parentId: index === 1 || index === 2 ? "aria-0" : null,
		orderKey: index * 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `aria-${index}-main` },
		createdAt: "2026-10-13T00:00:00.000Z",
		updatedAt: "2026-10-13T00:00:00.000Z",
	}));
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: [], knots: [], stashItemIds: [] } },
		}));
	await page.goto("/");
	const root = page.locator('[data-outline-row-id="aria-0"]');
	await expect(root).toHaveAttribute("aria-setsize", "998");
	await expect(root).toHaveAttribute("aria-posinset", "1");
	await expect(root).toHaveAttribute("aria-level", "1");
	const child = page.locator('[data-outline-row-id="aria-2"]');
	await expect(child).toHaveAttribute("aria-setsize", "2");
	await expect(child).toHaveAttribute("aria-posinset", "2");
	await expect(child).toHaveAttribute("aria-level", "2");
	expect(await page.getByRole("treeitem").count()).toBeLessThan(100);
	const result = await new AxeBuilder({ page }).withTags([
		"wcag2a",
		"wcag2aa",
		"wcag21a",
		"wcag21aa",
	]).analyze();
	expect(result.violations).toEqual([]);
	await page.route("**/api/rpc/setCollapsed", (route) => route.fulfill({ json: { result: null } }));
	await page.locator('[data-outline-row-id="aria-1"] .markdown-editor-host').dispatchEvent("click");
	await expect(page.locator('textarea[data-item-id="aria-1"]')).toBeFocused();
	await root.locator("button.disclosure").dispatchEvent("click");
	await expect(page.locator('[data-outline-row-id="aria-1"]')).toHaveCount(0);
	await expect(page.locator('textarea[data-item-id="aria-3"]')).toBeFocused();
});
