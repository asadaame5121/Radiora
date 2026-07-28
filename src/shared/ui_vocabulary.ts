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
	| "tag";

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
});
