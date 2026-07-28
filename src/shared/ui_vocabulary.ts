export type UiEntityCode =
	| "work"
	| "occurrence"
	| "semanticLink"
	| "workingCopy"
	| "revision"
	| "branch"
	| "merge"
	| "globalLineage"
	| "workLineage"
	| "recoverySnapshot"
	| "tag"
	| "bookmark"
	| "resumePosition"
	| "today"
	| "quickCapture"
	| "unplacedInbox"
	| "hoist"
	| "breadcrumb"
	| "browsingHistory"
	| "pane"
	| "query"
	| "commandPalette";

export type UiVocabulary = Readonly<Record<UiEntityCode, string>>;

export const DEFAULT_UI_VOCABULARY: UiVocabulary = Object.freeze({
	work: "項目",
	occurrence: "配置",
	semanticLink: "リンク",
	workingCopy: "作業中の本文",
	revision: "版",
	branch: "別稿",
	merge: "混成稿",
	globalLineage: "全体系統",
	workLineage: "版系統",
	recoverySnapshot: "復元用保存",
	tag: "タグ",
	bookmark: "栞",
	resumePosition: "作業再開位置",
	today: "今日",
	quickCapture: "クイック入力",
	unplacedInbox: "未配置箱",
	hoist: "絞り込み表示",
	breadcrumb: "祖先",
	browsingHistory: "閲覧履歴",
	pane: "ペイン",
	query: "Query",
	commandPalette: "コマンドパレット",
});
