import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";
import unitConfig from "./vitest.unit.config.ts";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	...viteConfig({ command: "serve", mode: "test", isSsrBuild: false, isPreview: false }),
	test: {
		projects: [
			unitConfig,
			{
				extends: true,
				plugins: [storybookTest({ configDir: join(root, ".storybook") })],
				test: {
					name: "storybook",
					fileParallelism: false,
					maxWorkers: 1,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
