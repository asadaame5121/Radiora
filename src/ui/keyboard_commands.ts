import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
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
		? { enabled: false, reason: "メモを選択してください。" }
		: outline(context);

export const KEYBOARD_COMMANDS: readonly CommandDefinition[] = [
	{
		id: "goBack",
		label: () => "アウトラインに戻る",
		shortcut: "Alt+ArrowLeft",
		availability: (context) =>
			context.canGoBack
				? ready(context)
				: { enabled: false, reason: "アウトラインを表示しています。" },
	},
	{ id: "showOutline", label: () => "アウトラインへ移動", chordKey: "o", availability: ready },
	{ id: "showTree", label: () => "ツリーへ移動", chordKey: "t", availability: ready },
	{
		id: "returnToEditor",
		label: () => "元の編集位置へ戻る",
		chordKey: "b",
		availability: (context) =>
			context.hasReturnPosition
				? ready(context)
				: { enabled: false, reason: "戻る編集位置がありません。" },
	},
	{ id: "focusSearch", label: () => "検索・メモジャンプ", chordKey: "j", availability: ready },
	{
		id: "focusQuickCapture",
		label: () => "クイック入力へ移動",
		chordKey: "n",
		availability: ready,
	},
	{ id: "toggleSidebar", label: () => "サイドバー開閉", chordKey: "s", availability: ready },
	{
		id: "collapseAll",
		label: () => "すべて折りたたむ",
		chordKey: "c",
		availability: outline,
	},
	{ id: "expandAll", label: () => "すべて展開する", chordKey: "e", availability: outline },
	{
		id: "toggleCollapsed",
		label: (vocabulary: UiVocabulary) => `選択した${vocabulary.work}の折りたたみ／展開`,
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
				: { enabled: false, reason: "フォーカス中ではありません。" },
	},
	{
		id: "removeOccurrence",
		label: (vocabulary: UiVocabulary) => `この${vocabulary.occurrence}を外す`,
		shortcut: "Ctrl+Shift+Backspace",
		availability: selected,
	},
];
