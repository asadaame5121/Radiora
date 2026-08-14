import { expect, test } from "@playwright/test";

const stories = [
	["toast", "feedback-toast--default"],
	["command-palette", "navigation-commandpalette--default"],
	["comparison-pane", "content-comparisonpane--revision-diff"],
	["duplicate-candidates", "discovery-duplicatecandidates--default"],
] as const;

const stageOneStories = [
	["primary-navigation", "navigation-primarynavigation--expanded"],
	["startup", "feedback-startupview--starting"],
	["save", "feedback-workingcopysavestatus--unsaved"],
	["options", "settings-optionsview--disabledandnotices"],
	["dialog", "feedback-confirmationdialog--rewrite"],
	["context-menu", "navigation-contextmenu--default"],
] as const;

for (const [name, storyId] of stories) {
	test(`${name} visual baseline`, async ({ page }) => {
		await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
		await page.locator("#storybook-root").waitFor({ state: "attached" });
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
	});
}

for (const [name, storyId] of stageOneStories) {
	for (
		const viewport of [
			{ name: "1280x800", width: 1280, height: 800 },
			{ name: "800x900", width: 800, height: 900 },
		]
	) {
		test(`${name} visual baseline (${viewport.name})`, async ({ page }) => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
			await page.locator("#storybook-root").waitFor({ state: "attached" });
			await page.waitForLoadState("networkidle");
			await expect(page).toHaveScreenshot(`${name}-${viewport.name}.png`, {
				fullPage: true,
			});
		});
	}
}
