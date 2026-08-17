import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/a11y",
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	use: {
		baseURL: "http://127.0.0.1:4173",
		browserName: "chromium",
		headless: true,
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
