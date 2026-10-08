import {
	DEFAULT_UI_CONCEPTS,
	freezeUiConcepts,
	type UiConceptCode,
	type UiConcepts,
} from "./ui_concepts.ts";

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
	| "quickCaptureDestination"
	| "quickCaptureDestinationRoot"
	| "quickCaptureDestinationUnplaced"
	| "unplacedInbox"
	| "hoist"
	| "breadcrumb"
	| "browsingHistory"
	| "pane"
	| "query"
	| "commandPalette"
	| "advancedLinkEditor"
	| "linkSource"
	| "linkType"
	| "linkTarget"
	| "directionPreview"
	| "internalReference"
	| "backlink"
	| "comparisonPane"
	| "comparisonLeft"
	| "comparisonRight"
	| "comparisonReason"
	| "fixedRevision"
	| "comparisonAdded"
	| "comparisonRemoved"
	| "comparisonUnchanged"
	| "unknownTime"
	| "markdownEditor"
	| "editorMode"
	| "editorNormal"
	| "editorPlain"
	| "editorPreview"
	| "sparseOutline"
	| "queryResult"
	| "noQueryResult"
	| "stub"
	| "stubList"
	| "stubContext"
	| "duplicateCandidates"
	| "duplicateReason"
	| "duplicateScore"
	| "duplicateCandidateHint"
	| "duplicateCandidateActions"
	| "duplicateMerge"
	| "duplicateKeepLeft"
	| "duplicateKeepRight"
	| "duplicateCreateLike"
	| "duplicateCreateRelated"
	| "duplicateDismiss"
	| "duplicateMergeConfirm"
	| "emergenceLoading"
	| "emergenceAccept"
	| "emergenceHold"
	| "emergenceDismiss"
	| "emergenceResolutionReason"
	| "noEmergenceSuggestion"
	| "manuscript"
	| "manuscriptOpen"
	| "manuscriptTotalCount"
	| "manuscriptBranchCount"
	| "manuscriptReadOnly"
	| "markdownExportMode"
	| "markdownExportSettings"
	| "markdownExportScope"
	| "markdownExportAll"
	| "markdownExportSelected"
	| "markdownExportAdvanced"
	| "markdownExportAncestors"
	| "markdownExportDescendants"
	| "markdownExportSemanticNeighbors"
	| "markdownExportSelectionRequired"
	| "markdownExportAction"
	| "markdownExportRadiora"
	| "markdownExportPortable"
	| "markdownExportObsidian"
	| "opmlExport"
	| "opmlImport"
	| "opmlExportSuccess"
	| "opmlImportSuccess"
	| "jsonBackupExport"
	| "jsonBackupExportSuccess"
	| "jsonBackupRestore"
	| "jsonBackupRestoreSuccess"
	| "jsonBackupRestoreFailureRecovery";

export type UiVocabulary = Readonly<Record<UiEntityCode, string>>;

export const DEFAULT_UI_VOCABULARY: UiVocabulary = Object.freeze({
	work: DEFAULT_UI_CONCEPTS.work.label,
	occurrence: DEFAULT_UI_CONCEPTS.occurrence.label,
	semanticLink: DEFAULT_UI_CONCEPTS.semanticLink.label,
	workingCopy: "本文",
	revision: DEFAULT_UI_CONCEPTS.revision.label,
	branch: "別稿",
	merge: "統合版",
	globalLineage: DEFAULT_UI_CONCEPTS.globalLineage.label,
	workLineage: DEFAULT_UI_CONCEPTS.workLineage.label,
	recoverySnapshot: "復元ポイント",
	tag: "タグ",
	bookmark: "栞",
	resumePosition: "前回の位置",
	today: "今日",
	quickCapture: "クイック入力",
	quickCaptureDestination: "クイック入力の保存先",
	quickCaptureDestinationRoot: "ルート直下",
	quickCaptureDestinationUnplaced: "未配置メモ",
	unplacedInbox: "未配置メモ",
	hoist: DEFAULT_UI_CONCEPTS.hoist.label,
	breadcrumb: "現在位置",
	browsingHistory: "閲覧履歴",
	pane: "ペイン",
	query: "検索",
	commandPalette: "コマンドパレット",
	advancedLinkEditor: "関係を編集",
	linkSource: "リンク元",
	linkType: "種類",
	linkTarget: "リンク先",
	directionPreview: "関係の向き",
	internalReference: "メモへのリンク",
	backlink: "このメモへのリンク",
	comparisonPane: "比較",
	comparisonLeft: "左",
	comparisonRight: "右",
	comparisonReason: "理由",
	fixedRevision: "固定バージョン",
	comparisonAdded: "追加",
	comparisonRemoved: "削除",
	comparisonUnchanged: "変更なし",
	unknownTime: "日時不明",
	markdownEditor: "Markdown編集",
	editorMode: "表示",
	editorNormal: "通常",
	editorPlain: "Markdown",
	editorPreview: "プレビュー",
	sparseOutline: DEFAULT_UI_CONCEPTS.sparseOutline.label,
	queryResult: "結果",
	noQueryResult: "一致するメモはありません",
	stub: "仮メモ",
	stubList: "仮メモ一覧",
	stubContext: "作成元",
	duplicateCandidates: "重複候補",
	duplicateReason: "根拠",
	duplicateScore: "一致度",
	duplicateCandidateHint:
		"メモのタイトル・検索別名・タグ・関係の一致を根拠に、操作を選べます。候補が自動採用されることはありません。",
	duplicateCandidateActions: "重複候補の操作",
	duplicateMerge: "統合する",
	duplicateKeepLeft: "左のメモを残す",
	duplicateKeepRight: "右のメモを残す",
	duplicateCreateLike: "似ている",
	duplicateCreateRelated: "関係あり",
	duplicateDismiss: "却下（何もしない）",
	duplicateMergeConfirm: "メモを統合しますか？",
	emergenceLoading: "関係を探索中…",
	emergenceAccept: "採用",
	emergenceHold: "保留",
	emergenceDismiss: "却下",
	emergenceResolutionReason: "判断理由（任意）",
	noEmergenceSuggestion: "新しい関係候補はありません",
	manuscript: "原稿",
	manuscriptOpen: "原稿として開く",
	manuscriptTotalCount: "全体文字数",
	manuscriptBranchCount: "この範囲の文字数",
	manuscriptReadOnly: "固定バージョンのため読み取り専用",
	markdownExportMode: "Markdown参照形式",
	markdownExportSettings: "Markdown書き出し設定",
	markdownExportScope: "書き出す範囲",
	markdownExportAll: "アウトライン全体",
	markdownExportSelected: "選択したメモを基準",
	markdownExportAdvanced: "高度な範囲設定",
	markdownExportAncestors: "上位のメモを含める",
	markdownExportDescendants: "下位のメモをすべて含める",
	markdownExportSemanticNeighbors: "関係で直接つながるメモを含める",
	markdownExportSelectionRequired: "選択したメモを基準にするには、メモを選択してください。",
	markdownExportAction: "Markdownでエクスポート",
	markdownExportRadiora: "Radiora（メモへのリンクを保持）",
	markdownExportPortable: "ポータブル（表示名のみ）",
	markdownExportObsidian: "Obsidian（Wikiリンク）",
	opmlExport: "OPMLを書き出す",
	opmlImport: "OPMLを取り込む",
	opmlExportSuccess: "OPMLを書き出しました",
	opmlImportSuccess: "OPMLを取り込みました",
	jsonBackupExport: "完全バックアップを書き出す",
	jsonBackupExportSuccess: "完全バックアップを書き出しました",
	jsonBackupRestore: "完全バックアップから復元",
	jsonBackupRestoreSuccess: "完全バックアップを復元しました",
	jsonBackupRestoreFailureRecovery:
		"現在のデータは変更されていません。空き容量とファイル内容を確認して、もう一度お試しください。",
});

export type UiVocabularyDefinition = Readonly<{
	vocabulary: UiVocabulary;
	concepts: UiConcepts;
}>;

/** Concept labels and descriptions share one source; action and notice labels remain strings. */
export function createUiVocabulary(
	concepts: UiConcepts,
	labels: Partial<Omit<UiVocabulary, UiConceptCode>> = {},
): UiVocabularyDefinition {
	const snapshot = freezeUiConcepts(concepts);
	const vocabulary: UiVocabulary = Object.freeze({
		...DEFAULT_UI_VOCABULARY,
		...labels,
		work: snapshot.work.label,
		occurrence: snapshot.occurrence.label,
		semanticLink: snapshot.semanticLink.label,
		revision: snapshot.revision.label,
		hoist: snapshot.hoist.label,
		workLineage: snapshot.workLineage.label,
		globalLineage: snapshot.globalLineage.label,
		sparseOutline: snapshot.sparseOutline.label,
	});
	return Object.freeze({ vocabulary, concepts: snapshot });
}

export const DEFAULT_UI_VOCABULARY_DEFINITION: UiVocabularyDefinition = Object.freeze({
	vocabulary: DEFAULT_UI_VOCABULARY,
	concepts: DEFAULT_UI_CONCEPTS,
});
