import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import { DEFAULT_UI_VOCABULARY, type UiEntityCode } from "../src/shared/ui_vocabulary.ts";

Deno.test("default UI vocabulary covers every semantic entity code with neutral labels", () => {
	const codes: UiEntityCode[] = [
		"work",
		"occurrence",
		"semanticLink",
		"workingCopy",
		"revision",
		"branch",
		"merge",
		"globalLineage",
		"workLineage",
		"recoverySnapshot",
		"tag",
		"bookmark",
		"resumePosition",
		"today",
		"quickCapture",
		"unplacedInbox",
		"hoist",
		"breadcrumb",
		"browsingHistory",
		"pane",
	];
	assertEquals(Object.keys(DEFAULT_UI_VOCABULARY).sort(), [...codes].sort());
	assertFalse(Object.values(DEFAULT_UI_VOCABULARY).some((label) => /実身|化身/.test(label)));
	assertEquals(DEFAULT_UI_VOCABULARY, {
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
	});
});
