import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/** Unit-only entry point avoids loading Storybook/browser tooling during daily TDD. */
export default defineConfig({
	...viteConfig({ command: "serve", mode: "test", isSsrBuild: false, isPreview: false }),
	test: {
		name: "unit",
		include: ["vitest/**/*.test.ts"],
	},
});
