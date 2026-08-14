import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import ContextMenuHarness from "./ContextMenuHarness.svelte";

const items = [
	{ id: "open", label: "開く" },
	{ id: "rename", label: "名前を変更", separatorBefore: true },
	{ id: "delete", label: "削除", danger: true },
] as const;

const itemsWithDisabled = [
	{ id: "open", label: "開く" },
	{ id: "archive", label: "アーカイブ", disabled: true, reason: "権限がありません" },
	{ id: "delete", label: "削除", disabled: true, danger: true },
] as const;

const meta = {
	title: "Navigation/ContextMenu",
	component: ContextMenuHarness,
	args: {
		items,
		onSelect: fn(),
		onClose: fn(),
	},
} satisfies Meta<typeof ContextMenuHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openMenu(canvasElement: HTMLElement) {
	const canvas = within(canvasElement);
	const trigger = canvas.getByRole("button", { name: "項目メニューを開く" });
	await userEvent.click(trigger, { button: "right" });
	return { canvas, trigger, menu: await canvas.findByRole("menu") };
}

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const { canvas, menu } = await openMenu(canvasElement);
		await expect(menu).toBeVisible();
		await userEvent.click(canvas.getByRole("menuitem", { name: "開く" }));
		await expect(args.onSelect).toHaveBeenCalledWith("open");
		await expect(args.onClose).toHaveBeenCalledOnce();
	},
};

export const DisabledItem: Story = {
	args: { items: itemsWithDisabled },
	play: async ({ canvasElement, args }) => {
		const { canvas } = await openMenu(canvasElement);
		const disabled = canvas.getByRole("menuitem", { name: "アーカイブ" });
		await expect(disabled).toBeDisabled();
		await userEvent.keyboard("{ArrowDown}{Enter}");
		await expect(args.onSelect).toHaveBeenCalledWith("open");
	},
};

export const AtViewportEdge: Story = {
	play: async ({ canvasElement }) => {
		const story = canvasElement.querySelector<HTMLElement>(".context-menu-story");
		const trigger = canvasElement.querySelector<HTMLButtonElement>(".context-menu-story > button");
		if (!story || !trigger) throw new Error("Context menu trigger was not rendered");
		story.style.position = "relative";
		story.style.height = "500px";
		trigger.style.position = "absolute";
		trigger.style.right = "8px";
		trigger.style.bottom = "8px";
		await userEvent.click(trigger, { button: "right" });
		const menu = await within(canvasElement).findByRole("menu");
		await expect(menu).toBeVisible();
		const menuBox = menu.getBoundingClientRect();
		await expect(menuBox.right).toBeLessThanOrEqual(window.innerWidth);
		await expect(menuBox.bottom).toBeLessThanOrEqual(window.innerHeight);
	},
};
