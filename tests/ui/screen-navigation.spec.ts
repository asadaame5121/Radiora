import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	const items = ["mock-1", "mock-7"].map((id, index) => ({
		id,
		workId: id,
		text: `${id} editable text`,
		parentId: null,
		orderKey: index,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${id}-main` },
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z",
	}));
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: [], knots: [], stashItemIds: [] } },
		}));
	for (const method of ["listUnplacedWorks", "listStubs", "listDuplicateCandidates"]) {
		await page.route(`**/api/rpc/${method}`, (route) => route.fulfill({ json: { result: [] } }));
	}
});

test("Option → trash → Option → outline preserves the return chain", async ({ page }) => {
	await page.goto("/");
	const back = page.getByRole("button", { name: "前の画面へ戻る", exact: true });
	await expect(back).toBeDisabled();
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await expect(back).toBeEnabled();
	await page.getByRole("button", { name: "項目を復元する", exact: true }).click();
	await back.click();
	await expect(page.getByRole("heading", { name: "Option", exact: true })).toBeVisible();
	await page.keyboard.press("Alt+ArrowLeft");
	await expect(page.getByRole("tree")).toBeVisible();
	await expect(back).toBeDisabled();
});

test("tree is the caller when opening help, including with collapsed navigation", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "ナビゲーションを閉じる" }).click();
	await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
	await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeVisible();
});

test("every primary navigation screen returns to the tree caller", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	const navigation = page.getByRole("navigation", { name: "主な画面" });
	for (const name of ["今日", "未配置項目", "未完成項目一覧", "重複候補", "タグ管理", "Option"]) {
		await navigation.getByRole("button", { name, exact: true }).click();
		await expect(page.getByRole("group", { name: "思索の系統樹" })).toHaveCount(0);
		await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
		await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeVisible();
	}
});

test("Query tool returns to the previous inspector and selection", async ({ page }) => {
	await page.goto("/");
	const editor = page.locator('textarea[data-item-id="mock-7"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await expect(editor).toBeFocused();
	await page.getByRole("button", { name: "Query・検索別名", exact: true }).click();
	await expect(page.locator(".query-panel")).toBeVisible();
	await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
	await expect(page.getByRole("tab", { name: "概要", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(editor).toBeFocused();
});

test("revision comparison returns to the original occurrence and history tab", async ({ page }) => {
	await page.goto("/");
	const editor = page.locator('textarea[data-item-id="mock-7"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await expect(editor).toBeFocused();
	await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 7));
	await page.getByRole("tab", { name: "履歴", exact: true }).click();
	await page.getByRole("button", { name: "版比較を開く", exact: true }).click();
	await expect(page.locator(".revision-comparison")).toBeVisible();
	await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
	await expect(editor).toBeFocused();
	await expect(page.getByRole("tab", { name: "履歴", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	expect(
		await editor.evaluate((
			element: HTMLTextAreaElement,
		) => [element.selectionStart, element.selectionEnd]),
	).toEqual([3, 7]);
});
