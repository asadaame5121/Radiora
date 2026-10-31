import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("in-app help is a dedicated, reachable and scannable page", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const viewMode = await readFile(
		new URL("../../../src/ui/app_view_mode.ts", import.meta.url),
		"utf8",
	);
	const navigation = await readFile(
		new URL("../../../src/ui/PrimaryNavigation.svelte", import.meta.url),
		"utf8",
	);
	const help = await readFile(new URL("../../../src/ui/InAppHelp.svelte", import.meta.url), "utf8");
	const updateController = await readFile(
		new URL("../../../src/ui/help_update_controller.svelte.ts", import.meta.url),
		"utf8",
	);

	// Navigation and reachability
	expect(viewMode.includes('| "help"')).toBeTruthy();
	expect(navigation.includes('activeView === "help"')).toBeTruthy();
	expect(navigation).toMatch(/aria-label="ヘルプ"[\s\S]*?onclick=\{onOpenHelp\}>\?<\/button>/);
	expect(app.includes('viewMode === "help"')).toBeTruthy();
	expect(app.includes("InAppHelp")).toBeTruthy();
	expect(app.includes("function openHelp()")).toBeTruthy();
	const keyboard = await readFile(
		new URL("../../../src/ui/global_keyboard_adapter.ts", import.meta.url),
		"utf8",
	);
	expect(keyboard.includes('event.key === "F1"')).toBeTruthy();
	expect(app.includes("help: () =>")).toBeTruthy();

	// Semantic layout and headings
	expect(help.includes('aria-labelledby="help-title"')).toBeTruthy();
	expect(help.includes("help-grid")).toBeTruthy();
	expect(help.includes("アウトラインとクイック入力")).toBeTruthy();
	expect(help.includes("日々の確認と長文執筆")).toBeTruthy();
	expect(help.includes("参照と意味関係")).toBeTruthy();
	expect(help.includes("版・別稿・系統と復元")).toBeTruthy();
	expect(help.includes("発見・重複候補")).toBeTruthy();
	expect(help.includes("Queryは再評価のため利用を停止しています。")).toBeTruthy();
	expect(help.includes("保存・移行・バックアップ")).toBeTruthy();
	expect(help.includes("キーボードで素早く操作する")).toBeTruthy();

	// Key vocabulary and distinctions
	expect(help.includes("クイック入力")).toBeTruthy();
	expect(help.includes("未配置項目")).toBeTruthy();
	expect(help.includes("今日")).toBeTruthy();
	expect(help.includes("栞")).toBeTruthy();
	expect(help.includes("前回の位置")).toBeTruthy();
	expect(help.includes("長文編集モード")).toBeTruthy();
	expect(help.includes("[[")).toBeTruthy();
	expect(help.includes("内部参照")).toBeTruthy();
	expect(help.includes("@")).toBeTruthy();
	expect(help.includes("関係型と向きを確定")).toBeTruthy();
	expect(help.includes("これは内部参照とは別")).toBeTruthy();
	expect(help.includes("DEF</code>")).toBeTruthy();
	expect(help.includes("版として残す")).toBeTruthy();
	expect(help.includes("別稿")).toBeTruthy();
	expect(help.includes("復元ポイント（Recovery Snapshot）")).toBeTruthy();
	expect(help.includes("比較")).toBeTruthy();
	expect(help.includes("ツリーの全体像")).toBeTruthy();
	expect(help.includes("版の履歴")).toBeTruthy();
	expect(help.includes("Chronology")).toBeTruthy();
	expect(help.includes("Lineage")).toBeTruthy();
	expect(help.includes("Query")).toBeTruthy();
	expect(help.includes("未完成項目一覧")).toBeTruthy();
	expect(help.includes("重複候補")).toBeTruthy();
	expect(help.includes("SQLite")).toBeTruthy();
	expect(help.includes("READMEの移行手順")).toBeTruthy();
	expect(help.includes("Markdown")).toBeTruthy();
	expect(help.includes("OPML")).toBeTruthy();
	expect(help.includes("完全JSONバックアップ")).toBeTruthy();

	// Update controller bindings
	expect(help.includes("createHelpUpdateController")).toBeTruthy();
	expect(help.includes("RELEASE_PAGE_URL")).toBeTruthy();
	expect(help.includes("href={RELEASE_PAGE_URL}")).toBeTruthy();
	expect(help.includes("void update.check()")).toBeTruthy();
	expect(help.includes('rel="noopener noreferrer"')).toBeTruthy();
	expect(help.includes("現在版")).toBeTruthy();
	expect(help.includes("最新版")).toBeTruthy();
	expect(help.includes("更新情報を確認できませんでした")).toBeTruthy();

	// Styles
	expect(help.includes(".help-panel")).toBeTruthy();
	expect(help.includes(".help-grid")).toBeTruthy();
	expect(help.includes(".help-card--wide")).toBeTruthy();

	// Update controller
	expect(updateController.includes("checkForUpdate")).toBeTruthy();
	expect(updateController.includes('status = "unavailable"')).toBeTruthy();
});
