import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { renderedContrast } from "../ui/theme_contrast.ts";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function openReadyApplication(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.getByRole("navigation", { name: "主な画面" })).toBeVisible();
	await expect(page.getByRole("button", { name: "アウトライン", exact: true })).toBeVisible();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
	expect(results.violations).toEqual([]);
}

test("Outline and expanded navigation have no automated WCAG A/AA violations", async ({ page }) => {
	await openReadyApplication(page);
	await expectNoAxeViolations(page);
});

test("Light theme keeps focused Outline text on the application foreground", async ({ page }) => {
	await openReadyApplication(page);
	await page.getByRole("button", { name: "Light", exact: true }).click();
	await page.getByRole("button", { name: "Markdown編集を開始" }).first().click();

	const editor = page.getByRole("textbox", { name: "Markdown編集" }).first();
	await expect(editor).toBeFocused();
	await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).color)).toBe(
		"rgb(17, 17, 17)",
	);
});

test("Light confirmation dialog passes axe and rendered text contrast", async ({ page }) => {
	const items = [{
		id: "palette-item-1",
		workId: "palette-item-1",
		text: "palette-item-1 editable text",
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch" as const, branchId: "palette-item-1-main" },
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z",
	}];
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: [], knots: [], stashItemIds: [] } },
		}));
	await page.route("**/api/rpc/listGlobalLineage", (route) =>
		route.fulfill({
			json: {
				result: {
					snapshot: { items, links: [], knots: [], stashItemIds: [] },
					promotedBranches: [],
					totalWorkCount: items.length,
					filteredWorkCount: items.length,
				},
			},
		}));
	await openReadyApplication(page);
	await page.getByRole("button", { name: "Light", exact: true }).click();
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.keyboard.press("Control+k");
	const palette = page.getByRole("dialog", { name: "コマンドパレット" });
	await expect(palette).toBeVisible();
	await palette.getByRole("option", { name: /^別稿として保存/ }).click();

	const confirmation = page.getByRole("dialog", { name: "新しい別稿として書き直しますか？" });
	await expect(confirmation).toBeVisible();
	const title = confirmation.getByRole("heading");
	const description = confirmation.locator("p:not(.eyebrow)");
	await expect(title).toContainText("書き直しますか");
	await expect(description).toContainText("分岐点として保存");
	await expect(description).toBeVisible();
	await expect.poll(() => title.evaluate((element) => getComputedStyle(element).color))
		.toBe("rgb(17, 17, 17)");
	await expect.poll(() => description.evaluate((element) => getComputedStyle(element).color))
		.toBe("rgb(98, 91, 80)");
	await expect.poll(() =>
		confirmation.evaluate((element) => getComputedStyle(element).backgroundColor)
	)
		.toBe("rgb(236, 229, 216)");

	const dialogAxe = await new AxeBuilder({ page })
		.include('[role="dialog"][aria-labelledby="confirmation-title"]')
		.withTags(wcagTags)
		.analyze();
	expect(dialogAxe.violations).toEqual([]);
	expect(await renderedContrast(title)).toBeGreaterThanOrEqual(4.5);
	expect(await renderedContrast(description)).toBeGreaterThanOrEqual(4.5);
});

test("Tree view has no automated WCAG A/AA violations", async ({ page }) => {
	await openReadyApplication(page);
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeVisible();
	await expectNoAxeViolations(page);
});

test("Options and collapsed navigation have no automated WCAG A/AA violations", async ({ page }) => {
	await openReadyApplication(page);
	const navigation = page.getByRole("navigation", { name: "主な画面" });
	await navigation.getByRole("button", { name: "Option", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Option", exact: true })).toBeVisible();
	await navigation.getByRole("button", { name: "ナビゲーションを閉じる" }).click();
	await expect(navigation.getByRole("button", { name: "ナビゲーションを開く" })).toBeVisible();
	await expectNoAxeViolations(page);
});

test("Command palette has no automated WCAG A/AA violations", async ({ page }) => {
	await openReadyApplication(page);
	await page.keyboard.press("Control+K");
	await expect(page.getByRole("dialog", { name: "コマンドパレット" })).toBeVisible();
	await expectNoAxeViolations(page);
});

test("Responsive shell has no automated WCAG A/AA violations", async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 900 });
	await openReadyApplication(page);
	await expectNoAxeViolations(page);
});
