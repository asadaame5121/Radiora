import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("in-app help is a dedicated, reachable and scannable page", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const viewMode = await Deno.readTextFile(new URL("../src/ui/app_view_mode.ts", import.meta.url));
	const navigation = await Deno.readTextFile(
		new URL("../src/ui/PrimaryNavigation.svelte", import.meta.url),
	);
	const help = await Deno.readTextFile(new URL("../src/ui/InAppHelp.svelte", import.meta.url));
	const updateController = await Deno.readTextFile(
		new URL("../src/ui/help_update_controller.svelte.ts", import.meta.url),
	);

	// Navigation and reachability
	assert(viewMode.includes('| "help"'));
	assert(navigation.includes('activeView === "help"'));
	assertMatch(navigation, /aria-label="ヘルプ"[\s\S]*?onclick=\{onOpenHelp\}>\?<\/button>/);
	assert(app.includes('viewMode === "help"'));
	assert(app.includes("InAppHelp"));
	assert(app.includes("function openHelp()"));
	assert(app.includes('event.key === "F1"'));

	// Semantic layout and headings
	assert(help.includes('aria-labelledby="help-title"'));
	assert(help.includes("help-grid"));
	assert(help.includes("アウトラインとクイック入力"));
	assert(help.includes("日々の確認と長文執筆"));
	assert(help.includes("参照と意味関係"));
	assert(help.includes("版・別稿・系統と復元"));
	assert(help.includes("発見・Query・重複候補"));
	assert(help.includes("保存・移行・バックアップ"));
	assert(help.includes("キーボードで素早く操作する"));

	// Key vocabulary and distinctions
	assert(help.includes("クイック入力"));
	assert(help.includes("未配置箱"));
	assert(help.includes("今日"));
	assert(help.includes("栞"));
	assert(help.includes("再開位置"));
	assert(help.includes("長文編集モード"));
	assert(help.includes("[["));
	assert(help.includes("内部参照"));
	assert(help.includes("@"));
	assert(help.includes("意味関係検索"));
	assert(help.includes("内部参照ではありません"));
	assert(help.includes("DEF</code>"));
	assert(help.includes("版として残す"));
	assert(help.includes("別稿"));
	assert(help.includes("復旧履歴（Recovery Snapshot）"));
	assert(help.includes("比較"));
	assert(help.includes("全体系統"));
	assert(help.includes("版系統"));
	assert(help.includes("Chronology"));
	assert(help.includes("Lineage"));
	assert(help.includes("Query"));
	assert(help.includes("Stub一覧"));
	assert(help.includes("重複候補"));
	assert(help.includes("SQLite"));
	assert(help.includes("READMEの移行手順"));
	assert(help.includes("Markdown"));
	assert(help.includes("OPML"));
	assert(help.includes("完全JSONバックアップ"));

	// Update controller bindings
	assert(help.includes("createHelpUpdateController"));
	assert(help.includes("RELEASE_PAGE_URL"));
	assert(help.includes("href={RELEASE_PAGE_URL}"));
	assert(help.includes("void update.check()"));
	assert(help.includes('rel="noopener noreferrer"'));
	assert(help.includes("現在版"));
	assert(help.includes("最新版"));
	assert(help.includes("更新情報を確認できませんでした"));

	// Styles
	assert(help.includes(".help-panel"));
	assert(help.includes(".help-grid"));
	assert(help.includes(".help-card--wide"));

	// Update controller
	assert(updateController.includes("checkForUpdate"));
	assert(updateController.includes('status = "unavailable"'));
});
