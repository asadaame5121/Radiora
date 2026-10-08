import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/a11y",
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	// Leave room for the UI suite and artifact upload within the CI job's 15-minute limit.
	globalTimeout: process.env.CI ? 3 * 60_000 : undefined,
	reporter: process.env.CI ? [["line"], ["github"]] : "list",
	outputDir: "test-results/a11y",
	use: {
		baseURL: "http://127.0.0.1:4173",
		browserName: "chromium",
		headless: true,
		trace: "retain-on-failure",
		locale: "ja-JP",
		timezoneId: "Asia/Tokyo",
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command: "npm run dev:mock -- --host 127.0.0.1 --port 4173",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
