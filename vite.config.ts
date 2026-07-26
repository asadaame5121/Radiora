import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { mockUiPlugin } from "./scripts/mock_ui_plugin.ts";

export default defineConfig(({ mode }) => ({
	plugins: [mode === "mock" ? mockUiPlugin() : null, svelte()].filter((plugin) => plugin !== null),
	build: { target: "es2022" },
}));
