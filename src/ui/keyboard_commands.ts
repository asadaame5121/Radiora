import type { CommandContext, CommandDefinition } from "./command_service.ts";

const ready = (context: CommandContext) =>
	context.startupReady
		? { enabled: true }
		: { enabled: false, reason: "起動の完了後に実行できます。" };
const outline = (context: CommandContext) =>
	!context.isOutline
		? { enabled: false, reason: "アウトライン編集で実行できます。" }
		: ready(context);
const selected = (context: CommandContext) =>
	!context.selectedOccurrenceId
		? { enabled: false, reason: "項目を選択してください。" }
		: outline(context);

export const KEYBOARD_COMMANDS: readonly CommandDefinition[] = [
	{ id: "showOutline", label: () => "Outlineへ移動", chordKey: "o", availability: ready },
	{ id: "showTree", label: () => "Treeへ移動", chordKey: "t", availability: ready },
	{
		id: "returnToEditor",
		label: () => "元の編集位置へ戻る",
		chordKey: "b",
		availability: (context) =>
			context.hasReturnPosition
				? ready(context)
				: { enabled: false, reason: "戻る編集位置がありません。" },
	},
	{ id: "focusSearch", label: () => "検索・項目ジャンプ", chordKey: "j", availability: ready },
	{
		id: "focusQuickCapture",
		label: () => "クイック入力へ移動",
		chordKey: "n",
		availability: ready,
	},
	{ id: "toggleSidebar", label: () => "サイドバー開閉", chordKey: "s", availability: ready },
	{
		id: "collapseAll",
		label: () => "すべてのNodeを折りたたむ",
		chordKey: "c",
		availability: outline,
	},
	{ id: "expandAll", label: () => "すべてのNodeを展開する", chordKey: "e", availability: outline },
	{
		id: "toggleCollapsed",
		label: () => "選択項目の折りたたみ／展開",
		shortcut: "Ctrl+.",
		availability: selected,
	},
	{
		id: "zoomOut",
		label: () => "親階層へ戻る",
		shortcut: "Alt+,",
		availability: (context) =>
			context.isHoisted
				? outline(context)
				: { enabled: false, reason: "絞り込み表示中ではありません。" },
	},
	{
		id: "removeOccurrence",
		label: () => "この配置を削除",
		shortcut: "Ctrl+Shift+Backspace",
		availability: selected,
	},
];
