import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import DuplicateCandidatesPanel from "../src/ui/DuplicateCandidatesPanel.svelte";
import { expect, fn, userEvent, within } from "storybook/test";

const candidates = [{
	workA: { workId: "work-a", title: "静的解析の導入" },
	workB: { workId: "work-b", title: "静的検査を追加する" },
	score: 82,
	reasons: [{ kind: "title" as const, label: "タイトルが類似", score: 50 }],
}];

const meta = {
	title: "Discovery/DuplicateCandidates",
	component: DuplicateCandidatesPanel,
	args: {
		candidates,
		vocabulary: DEFAULT_UI_VOCABULARY,
		onRequestMerge: fn(),
		onCreateLink: fn(),
		onDismiss: fn(),
	},
} satisfies Meta<typeof DuplicateCandidatesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: DEFAULT_UI_VOCABULARY.duplicateDismiss }),
		);
		await expect(args.onDismiss).toHaveBeenCalledOnce();
	},
};

export const Empty: Story = { args: { candidates: [] } };
