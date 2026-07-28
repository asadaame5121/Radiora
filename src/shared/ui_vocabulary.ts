export type UiEntityCode = "work" | "occurrence" | "semanticLink";

export type UiVocabulary = Readonly<Record<UiEntityCode, string>>;

export const DEFAULT_UI_VOCABULARY: UiVocabulary = Object.freeze({
	work: "項目",
	occurrence: "配置",
	semanticLink: "リンク",
});
