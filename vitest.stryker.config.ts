import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [svelte()],
	resolve: { conditions: ["browser"] },
	test: {
		include: ["vitest/**/*_controller.svelte.test.ts", "vitest/**/*controller.svelte.test.ts"],
	},
});
