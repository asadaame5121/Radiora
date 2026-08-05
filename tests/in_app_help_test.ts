import { assert } from "jsr:@std/assert@1";

Deno.test("in-app help is a dedicated, reachable and scannable page", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const help = await Deno.readTextFile(new URL("../src/ui/InAppHelp.svelte", import.meta.url));
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

	assert(app.includes('| "help"'));
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
	assert(styles.includes(".help-panel"));
	assert(styles.includes(".help-grid"));
	assert(styles.includes(".help-card--wide"));
});
