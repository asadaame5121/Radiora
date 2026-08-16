import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
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

const navigationItems = [
	{ id: "open", label: "開く" },
	{ id: "archive", label: "アーカイブ", disabled: true },
	{ id: "rename", label: "名前を変更" },
	{ id: "delete", label: "削除", danger: true },
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

type StoryQueries = ReturnType<typeof within>;

async function openMenu(canvasElement: HTMLElement) {
	const body = within(canvasElement.ownerDocument.body);
	const trigger = body.getByRole("button", { name: "項目メニューを開く" });
	const triggerBox = trigger.getBoundingClientRect();
	await fireEvent.contextMenu(trigger, { clientX: triggerBox.left, clientY: triggerBox.bottom });
	return { body, trigger, menu: await body.findByRole("menu") };
}

async function closeMenu(body: StoryQueries): Promise<void> {
	if (!body.queryByRole("menu")) return;
	await userEvent.keyboard("{Escape}");
	await waitFor(() => expect(body.queryByRole("menu")).not.toBeInTheDocument());
}

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const { body, menu } = await openMenu(canvasElement);
		try {
			await expect(menu).toBeVisible();
			await userEvent.click(body.getByRole("menuitem", { name: "開く" }));
			await expect(args.onSelect).toHaveBeenCalledWith("open");
			await expect(args.onClose).toHaveBeenCalledOnce();
		} finally {
			await closeMenu(body);
		}
	},
};

export const VisualOpen: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const trigger = body.getByRole("button", { name: "項目メニューを開く" });
		const triggerBox = trigger.getBoundingClientRect();
		await fireEvent.contextMenu(trigger, { clientX: triggerBox.left, clientY: triggerBox.bottom });
		await expect(await body.findByRole("menu")).toBeVisible();
	},
};

export const DisabledItem: Story = {
	args: { items: itemsWithDisabled },
	play: async ({ canvasElement, args }) => {
		const { body } = await openMenu(canvasElement);
		try {
			const disabled = body.getByRole("menuitem", { name: "アーカイブ" });
			await expect(disabled).toBeDisabled();
			await userEvent.keyboard("{ArrowDown}{Enter}");
			await expect(args.onSelect).toHaveBeenCalledWith("open");
		} finally {
			await closeMenu(body);
		}
	},
};

export const KeyboardNavigation: Story = {
	args: { items: navigationItems },
	play: async ({ canvasElement }) => {
		const { body } = await openMenu(canvasElement);
		try {
			const openItem = body.getByRole("menuitem", { name: "開く" });
			const renameItem = body.getByRole("menuitem", { name: "名前を変更" });
			const deleteItem = body.getByRole("menuitem", { name: "削除" });

			await expect(body.getByRole("menu")).toHaveFocus();
			await userEvent.keyboard("{ArrowDown}");
			await expect(openItem).toHaveFocus();
			await userEvent.keyboard("{ArrowDown}");
			await expect(renameItem).toHaveFocus();
			await userEvent.keyboard("{End}");
			await expect(deleteItem).toHaveFocus();
			await userEvent.keyboard("{Home}");
			await expect(openItem).toHaveFocus();
		} finally {
			await closeMenu(body);
		}
	},
};

export const ShiftF10: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const trigger = body.getByRole("button", { name: "項目メニューを開く" });
		try {
			trigger.focus();
			await userEvent.keyboard("{Shift>}{F10}{/Shift}");
			await expect(await body.findByRole("menu")).toBeVisible();
		} finally {
			await closeMenu(body);
		}
	},
};

export const SelectRestoresFocus: Story = {
	play: async ({ canvasElement, args }) => {
		const { body, trigger } = await openMenu(canvasElement);
		try {
			await userEvent.click(body.getByRole("menuitem", { name: "開く" }));
			await expect(args.onSelect).toHaveBeenCalledWith("open");
			await expect(trigger).toHaveFocus();
		} finally {
			await closeMenu(body);
		}
	},
};

export const EscapeRestoresFocus: Story = {
	play: async ({ canvasElement, args }) => {
		const { body, trigger } = await openMenu(canvasElement);
		try {
			await userEvent.keyboard("{Escape}");
			await waitFor(async () => {
				await expect(args.onClose).toHaveBeenCalledOnce();
				await expect(trigger).toHaveFocus();
			});
			await waitFor(() => expect(body.queryByRole("menu")).not.toBeInTheDocument());
		} finally {
			await closeMenu(body);
		}
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
		const triggerBox = trigger.getBoundingClientRect();
		await fireEvent.contextMenu(trigger, { clientX: triggerBox.right, clientY: triggerBox.bottom });
		const body = within(canvasElement.ownerDocument.body);
		try {
			const menu = await body.findByRole("menu");
			await expect(menu).toBeVisible();
			const menuBox = menu.getBoundingClientRect();
			await expect(menuBox.right).toBeLessThanOrEqual(window.innerWidth);
			await expect(menuBox.bottom).toBeLessThanOrEqual(window.innerHeight);
		} finally {
			await closeMenu(body);
		}
	},
};
