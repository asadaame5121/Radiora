import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { fn } from "storybook/test";
import OptionsView from "../src/ui/OptionsView.svelte";

const callbacks = {
	onPersistMarkdownExportPreference: fn(),
	onExportMarkdown: fn(),
	onImportOpml: fn(),
	onExportOpml: fn(),
	onExportJsonBackup: fn(),
	onRestoreJsonBackup: fn(),
	onTreeProjectionChange: fn(),
	onNavigationCollapsedChange: fn(),
	onInspectorCollapsedChange: fn(),
	onInspectorWidthChange: fn(),
	onPersistQuickCapturePreference: fn(),
	onOpenTrash: fn(),
	onOpenLicenses: fn(),
};

const meta = {
	title: "Settings/OptionsView",
	component: OptionsView,
	args: {
		markdownExportPreference: {
			scope: "all",
			referenceMode: "radiora",
			includeAncestors: true,
			includeDescendants: true,
			includeSemanticNeighbors: false,
		},
		quickCapturePreference: { destination: "root" },
		markdownExportEnabled: true,
		markdownExportReason: undefined,
		markdownExportSelectionRequired: false,
		markdownExportNotice: "",
		startupReady: true,
		opmlNotice: "",
		jsonBackupNotice: "",
		treeProjectionPreference: "chronology",
		navCollapsed: false,
		inspectorCollapsed: false,
		inspectorWidth: 360,
		...callbacks,
	},
} satisfies Meta<typeof OptionsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DisabledAndNotices: Story = {
	args: {
		markdownExportEnabled: false,
		markdownExportReason: "起動完了後に利用できます。",
		markdownExportNotice: "書き出しを待機しています。",
		startupReady: false,
		opmlNotice: "OPMLを読み込めませんでした。",
		jsonBackupNotice: "バックアップを確認してください。",
	},
};
