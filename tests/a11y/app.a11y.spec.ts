import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

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
