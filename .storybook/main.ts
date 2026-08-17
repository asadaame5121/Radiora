import type { StorybookConfig } from "@storybook/svelte-vite";

const config: StorybookConfig = {
	stories: ["../stories/**/*.stories.ts"],
	addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
	framework: {
		name: "@storybook/svelte-vite",
		options: {},
	},
	staticDirs: ["../public"],
};

export default config;
