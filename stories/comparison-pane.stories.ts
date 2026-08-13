import type { Meta, StoryObj } from "@storybook/svelte-vite";
import ComparisonPane from "../src/ui/ComparisonPane.svelte";

const documents = [
	{
		scope: "revision" as const,
		workId: "work-1",
		revisionId: "revision-1",
		title: "初稿",
		text: "第一段落\n削除される行",
		createdAt: "2026-08-01T00:00:00.000Z",
	},
	{
		scope: "revision" as const,
		workId: "work-1",
		revisionId: "revision-2",
		title: "改稿",
		text: "第一段落\n追加された行",
		createdAt: "2026-08-02T00:00:00.000Z",
	},
];

const meta = {
	title: "Content/ComparisonPane",
	component: ComparisonPane,
	args: { documents, context: { kind: "revision" } },
} satisfies Meta<typeof ComparisonPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RevisionDiff: Story = {};
export const Locked: Story = { args: { locked: true } };
export const InsufficientDocuments: Story = { args: { documents: documents.slice(0, 1) } };
