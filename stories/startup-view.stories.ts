import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { fn } from "storybook/test";
import StartupView from "../src/ui/StartupView.svelte";

const meta = {
	title: "Feedback/StartupView",
	component: StartupView,
	args: {
		startup: { phase: "starting", message: "Radioraを起動しています…" },
		onRetry: fn(),
	},
} satisfies Meta<typeof StartupView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = {};

export const Failed: Story = {
	args: {
		startup: {
			phase: "failed",
			message: "起動できませんでした。",
			detail: "SurrealDBへ接続できませんでした。",
			logPath: "C:\\Users\\Example\\AppData\\Local\\Radiora\\startup.log",
		},
	},
};
