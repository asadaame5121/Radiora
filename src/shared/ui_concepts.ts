/** Concepts carry explanations; operation text and notices remain at their own boundaries. */
export const UI_CONCEPT_CODES = [
	"work",
	"occurrence",
	"semanticLink",
	"revision",
	"hoist",
	"workLineage",
	"globalLineage",
	"sparseOutline",
] as const;

export type UiConceptCode = (typeof UI_CONCEPT_CODES)[number];
export interface UiConceptDefinition {
	readonly label: string;
	readonly description: string;
}
export type UiConcepts = Readonly<Record<UiConceptCode, UiConceptDefinition>>;

/** Capture an immutable snapshot, including each definition, for the mounted UI. */
export function freezeUiConcepts(concepts: UiConcepts): UiConcepts {
	return Object.freeze(
		Object.fromEntries(
			UI_CONCEPT_CODES.map((code) => [
				code,
				Object.freeze({ ...concepts[code] }),
			]),
		),
	) as Record<UiConceptCode, UiConceptDefinition>;
}

export const DEFAULT_UI_CONCEPTS: UiConcepts = freezeUiConcepts({
	work: {
		label: "メモ",
		description: "本文や関係を持つ、思考や文章のまとまりです。",
	},
	occurrence: {
		label: "表示場所",
		description:
			"このメモがアウトライン内に表示されている場所です。同じメモを複数の場所に置くこともできます。",
	},
	semanticLink: {
		label: "関係",
		description:
			"メモどうしの意味的なつながり（根拠・派生・対比など）です。「関係」タブから追加できます。",
	},
	revision: {
		label: "バージョン",
		description:
			"変更できない記録として固定保存した本文です。「バージョンとして保存」で作成できます。",
	},
	hoist: {
		label: "フォーカス",
		description: "選択したメモとその配下だけに視野を絞り込んでアウトラインに表示します。",
	},
	workLineage: {
		label: "バージョンの系譜",
		description:
			"このメモのバージョンや別稿が、どのように分かれ、まとまってきたかの系譜を表示します。",
	},
	globalLineage: {
		label: "ツリー",
		description: "メモどうしの関係や世代のつながりを、ツリー（系統樹）として表示します。",
	},
	sparseOutline: {
		label: "文脈付き表示",
		description: "検索条件に一致したメモを、親階層のつながりが分かる形で抜き出して表示します。",
	},
});
