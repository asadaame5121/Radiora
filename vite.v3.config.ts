import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * Release build of the v3 body-slice page for the Tauri host (`frontendDist: ../../dist-v3`).
 * Development serves `v3.html` from the regular Vite server instead (see v3_desktop_dev.ts).
 */
export default defineConfig({
	plugins: [svelte()],
	build: {
		target: "es2022",
		outDir: "dist-v3",
		emptyOutDir: true,
		rollupOptions: { input: "v3.html" },
	},
});
