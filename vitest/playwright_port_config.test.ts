import { describe, expect, it } from "vitest";
import { resolveUiServerSettings } from "../playwright.a11y.config.ts";

describe("Playwright UI server endpoint", () => {
	it("keeps the default endpoint and reusable local server when no port is specified", () => {
		expect(resolveUiServerSettings(undefined, false)).toEqual({
			port: 4173,
			baseURL: "http://127.0.0.1:4173",
			webServer: {
				command: "npm run dev:mock -- --host 127.0.0.1 --port 4173",
				url: "http://127.0.0.1:4173",
				reuseExistingServer: true,
				timeout: 120_000,
			},
		});
		expect(resolveUiServerSettings(undefined, true).webServer.reuseExistingServer).toBe(false);
	});

	it("uses an explicit valid port consistently and never reuses its server", () => {
		for (const port of ["1", "4174", "4173", "65535"]) {
			const settings = resolveUiServerSettings(port, false);
			expect(settings.port).toBe(Number(port));
			expect(settings.baseURL).toBe(`http://127.0.0.1:${port}`);
			expect(settings.webServer.command).toContain(`--port ${port}`);
			expect(settings.webServer.url).toBe(settings.baseURL);
			expect(settings.webServer.reuseExistingServer).toBe(false);
		}
	});

	it.each(["", "0", "65536", "4173.5", " 4174", "4174 ", "+4174", "abc"])(
		"rejects invalid RADIORA_UI_PORT value %j",
		(value) => {
			expect(() => resolveUiServerSettings(value, false)).toThrow(
				"RADIORA_UI_PORT must be a decimal integer between 1 and 65535.",
			);
		},
	);
});
