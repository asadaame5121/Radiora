import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import PrimaryNavigationHarness from "./PrimaryNavigationHarness.svelte";

const callbacks = {
	onToggleCollapse: fn(),
	onOpenToday: fn(),
	onOpenUnplaced: fn(),
	onOpenStubs: fn(),
	onOpenDuplicates: fn(),
	onOpenOptions: fn(),
	onOpenTags: fn(),
	onOpenQuery: fn(),
	onOpenHelp: fn(),
	onOpenRecentItem: fn(),
};

const meta = {
	title: "Navigation/PrimaryNavigation",
	component: PrimaryNavigationHarness,
	args: {
		collapsed: false,
		activeView: "outline",
		queryActive: false,
		queryAvailable: true,
		recentItems: [{
			workId: "work-1",
			id: "occurrence-1",
			title: "アクセシビリティ検証を整える",
			parentLabel: "品質改善",
			editedAtLabel: "今日 09:30",
		}],
		selectedId: "occurrence-1",
		...callbacks,
	},
} satisfies Meta<typeof PrimaryNavigationHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "ナビゲーションを閉じる" }));
		await expect(args.onToggleCollapse).toHaveBeenCalledOnce();
	},
};

export const Collapsed: Story = { args: { collapsed: true } };

export const EmptyRecentItems: Story = { args: { recentItems: [], selectedId: null } };
