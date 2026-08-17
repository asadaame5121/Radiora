import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/visual",
	snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	expect: { toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.001 } },
	use: {
		baseURL: "http://127.0.0.1:6006",
		browserName: "chromium",
		headless: true,
		locale: "ja-JP",
		timezoneId: "Asia/Tokyo",
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command: "npm run storybook -- --ci --no-open",
		url: "http://127.0.0.1:6006",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: { STORYBOOK_DISABLE_TELEMETRY: "1" },
	},
});
