import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/** Unit-only entry point avoids loading Storybook/browser tooling during daily TDD. */
export default defineConfig({
	...viteConfig({ command: "serve", mode: "test", isSsrBuild: false, isPreview: false }),
	test: {
		name: "unit",
		include: ["vitest/**/*.test.ts"],
		// Wall-clock budgets are flaky beside parallel workers; they run in the serial `perf` project.
		exclude: ["**/node_modules/**", "vitest/**/*.perf.test.ts"],
	},
});
