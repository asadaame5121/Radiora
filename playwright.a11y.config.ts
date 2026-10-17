import { defineConfig } from "@playwright/test";

export function resolveUiServerSettings(
	portValue: string | undefined,
	ci: boolean,
): {
	port: number;
	baseURL: string;
	webServer: {
		command: string;
		url: string;
		reuseExistingServer: boolean;
		timeout: number;
	};
} {
	let port = 4173;
	if (portValue !== undefined) {
		if (!/^[0-9]+$/.test(portValue)) {
			throw new Error("RADIORA_UI_PORT must be a decimal integer between 1 and 65535.");
		}
		port = Number(portValue);
		if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
			throw new Error("RADIORA_UI_PORT must be a decimal integer between 1 and 65535.");
		}
	}
	const url = `http://127.0.0.1:${port}`;
	return {
		port,
		baseURL: url,
		webServer: {
			command: `npm run dev:mock -- --host 127.0.0.1 --port ${port}`,
			url,
			reuseExistingServer: portValue === undefined && !ci,
			timeout: 120_000,
		},
	};
}

const server = resolveUiServerSettings(process.env.RADIORA_UI_PORT, Boolean(process.env.CI));

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
		baseURL: server.baseURL,
		browserName: "chromium",
		headless: true,
		trace: "retain-on-failure",
		locale: "ja-JP",
		timezoneId: "Asia/Tokyo",
		viewport: { width: 1280, height: 800 },
	},
	webServer: server.webServer,
});
