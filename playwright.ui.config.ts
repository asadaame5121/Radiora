import { defineConfig } from "@playwright/test";
import applicationConfig from "./playwright.a11y.config.ts";

export default defineConfig({
	...applicationConfig,
	testDir: "tests/ui",
	// Allow the first Vite/Svelte compilation; individual assertions retain their short timeout.
	timeout: 60_000,
});
