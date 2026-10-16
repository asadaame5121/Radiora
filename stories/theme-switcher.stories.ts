import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within } from "storybook/test";
import ThemeSwitcherHarness from "./ThemeSwitcherHarness.svelte";

const labels = { dark: "Dark", auto: "Auto", light: "Light" } as const;

const meta = {
	title: "Settings/ThemeSwitcher",
	component: ThemeSwitcherHarness,
	args: {},
} satisfies Meta<typeof ThemeSwitcherHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

async function checkSelection(
	canvasElement: HTMLElement,
	initial: "dark" | "auto" | "light",
	next: "dark" | "auto" | "light",
): Promise<void> {
	const canvas = within(canvasElement);
	const group = canvas.getByRole("group", { name: "テーマの切り替え" });
	const buttons = within(group).getAllByRole("button");
	await expect(within(group).getByRole("button", { name: labels[initial] })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true"))
		.toHaveLength(1);

	const nextButton = within(group).getByRole("button", { name: labels[next] });
	nextButton.focus();
	await userEvent.keyboard("{Enter}");
	await expect(nextButton).toHaveAttribute("aria-pressed", "true");
	await expect(canvas.getByText(`選択中: ${next} / 最後の変更: ${next}`)).toBeVisible();
	await expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true"))
		.toHaveLength(1);
}

export const Dark: Story = {
	args: { initialPreference: "dark" },
	play: ({ canvasElement }) => checkSelection(canvasElement, "dark", "auto"),
};

export const Auto: Story = {
	args: { initialPreference: "auto" },
	play: ({ canvasElement }) => checkSelection(canvasElement, "auto", "light"),
};

export const Light: Story = {
	args: { initialPreference: "light" },
	play: ({ canvasElement }) => checkSelection(canvasElement, "light", "dark"),
};
