import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("原稿ビューのルートとコンポーネントはアウトライン中心のUIから除去されている", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");

	expect(app.includes('import ManuscriptView from "./ManuscriptView.svelte"')).toBe(false);
	expect(app.includes("<ManuscriptView")).toBe(false);
	expect(app.includes('viewMode === "manuscript"')).toBe(false);
	expect(app.includes("openManuscript(")).toBe(false);
	expect(app.includes("manuscriptLoading")).toBe(false);
	expect(app.includes("vocabulary.manuscriptOpen")).toBeTruthy();
});
