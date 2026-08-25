export interface EditorBinding {
	label: string;
	keys: string;
}

/**
 * App.svelte のキーハンドラに直書きされている、コマンドパレットに載らないキー操作。
 * アプリ内ヘルプと docs:shortcuts の生成がこの一覧を共有する。
 * App.svelte のハンドラを変更したらここも更新する。
 */
export const EDITOR_BINDINGS: readonly EditorBinding[] = [
	{ label: "同じ階層に項目を追加", keys: "Enter" },
	{ label: "本文内で改行", keys: "Shift+Enter" },
	{ label: "子階層へ移動", keys: "Tab" },
	{ label: "親階層へ移動", keys: "Shift+Tab" },
	{ label: "上へ並べ替え", keys: "Alt+↑" },
	{ label: "下へ並べ替え", keys: "Alt+↓" },
	{ label: "項目へのリンク候補", keys: "本文で [[" },
	{ label: "関連先候補", keys: "本文で @" },
	{ label: "コマンドパレット", keys: "Ctrl+K" },
	{ label: "TreeとOutlineを切り替え", keys: "Space" },
	{ label: "ヘルプ", keys: "F1 / Ctrl+Shift+/" },
];
