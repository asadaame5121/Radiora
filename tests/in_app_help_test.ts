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

	assert(viewMode.includes('| "help"'));
	assert(navigation.includes('activeView === "help"'));
	assertMatch(navigation, /aria-label="ヘルプ"[\s\S]*?onclick=\{onOpenHelp\}>\?<\/button>/);
	assert(app.includes('viewMode === "help"'));
	assert(app.includes("InAppHelp"));
	assert(app.includes("function openHelp()"));
	assert(app.includes('event.key === "F1"'));
	assert(help.includes('aria-labelledby="help-title"'));
	assert(help.includes("help-grid"));
	assert(help.includes("アウトラインに項目を追加する"));
	assert(help.includes("DEF</code>（定義）"));
	assert(help.includes("保存と持ち出し"));
	assert(help.includes("キーボードで素早く操作する"));
	assert(help.includes("createHelpUpdateController"));
	assert(help.includes("RELEASE_PAGE_URL"));
	assert(help.includes("href={RELEASE_PAGE_URL}"));
	assert(help.includes("void update.check()"));
	assert(help.includes('rel="noopener noreferrer"'));
	assert(help.includes("現在版"));
	assert(help.includes("最新版"));
	assert(help.includes("更新情報を確認できませんでした"));
	assert(help.includes(".help-panel"));
	assert(help.includes(".help-grid"));
	assert(help.includes(".help-card--wide"));
	assert(updateController.includes("checkForUpdate"));
	assert(updateController.includes('status = "unavailable"'));
});
