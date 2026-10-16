import { defineConfig } from "@playwright/test";

/**
 * Full-stack smoke: browser UI → real RPC client → real backend → SQLite, with no mock Vite
 * plugin and no `page.route`. The fixture starts and restarts the test-only host, so this
 * config deliberately has no `webServer` and reuses none of the mock UI/a11y settings.
 *
 * Windows only: the smoke host refuses to run elsewhere. Run it through `npm run test:smoke`,
 * which builds `dist` first.
 */
export default defineConfig({
	testDir: "tests/smoke",
	// Only the smoke spec; the Deno integration test and the fixture module stay out of it.
	testMatch: /\.smoke\.spec\.ts$/,
	outputDir: "test-results/smoke",
	timeout: 120_000,
	// Room for two backend processes plus one Chromium instance on a cold CI runner.
	globalTimeout: process.env.CI ? 10 * 60_000 : undefined,
	reporter: process.env.CI ? [["line"], ["github"]] : "list",
	use: {
		browserName: "chromium",
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		locale: "ja-JP",
		timezoneId: "Asia/Tokyo",
		viewport: { width: 1280, height: 800 },
	},
});
