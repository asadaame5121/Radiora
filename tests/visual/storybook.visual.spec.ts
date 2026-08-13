import { expect, test } from "@playwright/test";

const stories = [
	["toast", "feedback-toast--default"],
	["command-palette", "navigation-commandpalette--default"],
	["comparison-pane", "content-comparisonpane--revision-diff"],
	["duplicate-candidates", "discovery-duplicatecandidates--default"],
] as const;

for (const [name, storyId] of stories) {
	test(`${name} visual baseline`, async ({ page }) => {
		await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
		await page.locator("#storybook-root").waitFor({ state: "attached" });
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
	});
}
