import type { Preview } from "@storybook/svelte-vite";
import "../src/ui/styles.css";

const preview: Preview = {
	parameters: {
		a11y: { test: "error" },
		controls: { expanded: true },
		layout: "fullscreen",
	},
	tags: ["autodocs"],
};

export default preview;
