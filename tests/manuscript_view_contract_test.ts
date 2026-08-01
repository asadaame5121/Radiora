import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("原稿ビューのルートとコンポーネントはアウトライン中心のUIから除去されている", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	assertFalse(app.includes('import ManuscriptView from "./ManuscriptView.svelte"'));
	assertFalse(app.includes("<ManuscriptView"));
	assertFalse(app.includes('viewMode === "manuscript"'));
	assertFalse(app.includes("openManuscript("));
	assertFalse(app.includes("manuscriptLoading"));
	assert(app.includes("長文編集"));
});
