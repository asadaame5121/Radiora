import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { desktopHmrProxyPlugin } from "./scripts/desktop_hmr_proxy_plugin.ts";
import { mockUiPlugin } from "./scripts/mock_ui_plugin.ts";

export default defineConfig(({ mode }) => ({
	plugins: [
		desktopHmrProxyPlugin(),
		mode === "mock" ? mockUiPlugin() : null,
		svelte(),
	].filter((plugin) => plugin !== null),
	build: { target: "es2022" },
}));
