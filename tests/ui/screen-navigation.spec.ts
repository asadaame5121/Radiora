import { expect, test } from "@playwright/test";

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

test.beforeEach(async ({ page }) => {
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: [], knots: [], stashItemIds: [] } },
		}));
	await page.route("**/api/rpc/listGlobalLineage", (route) =>
		route.fulfill({
			json: {
				result: {
					snapshot: { items, links: [], knots: [], stashItemIds: [] },
					promotedBranches: [],
					totalWorkCount: items.length,
					filteredWorkCount: items.length,
				},
			},
		}));
	for (const method of ["listUnplacedWorks", "listStubs", "listDuplicateCandidates"]) {
		await page.route(`**/api/rpc/${method}`, (route) => route.fulfill({ json: { result: [] } }));
	}
});

test("Today restores the caller's selection, hoist, and filter after opening another occurrence", async ({ page }) => {
	const destination = items[1];
	await page.route("**/api/rpc/projectDates", (route) =>
		route.fulfill({
			json: {
				result: {
					range: { startInclusive: "2026-09-05", endExclusive: "2026-09-06" },
					created: [{
						work: {
							id: destination.workId,
							createdAt: destination.createdAt,
							updatedAt: destination.updatedAt,
						},
						representative: destination,
						placements: [{ occurrence: destination, breadcrumb: [] }],
					}],
					updated: [],
				},
			},
		}));
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
	await page.keyboard.press("Control+Shift+H");
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]')).toHaveCount(0);
	await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "今日",
		exact: true,
	}).click();
	await page.getByRole("textbox", { name: "テキストで絞り込み", exact: true }).fill("mock-7");
	await page.locator(".date-entry").click();
	await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-7");
	await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "テキストで絞り込み", exact: true })).toHaveValue(
		"mock-7",
	);
	await expect(
		page.getByRole("complementary").getByRole("heading", {
			name: "mock-1 editable text",
			exact: true,
		}),
	).toBeVisible();
	await page.getByRole("button", { name: "アウトライン", exact: true }).click();
	await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-1");
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]')).toHaveCount(0);
});

test("a cancelled Recent selection adds no history, while a confirmed selection remembers its caller", async ({ page }) => {
	await page.route("**/api/rpc/projectDates", (route) =>
		route.fulfill({
			json: {
				result: {
					range: { startInclusive: "2026-09-05", endExclusive: "2026-09-06" },
					created: [],
					updated: [],
				},
			},
		}));
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
	await page.getByRole("textbox", { name: "年", exact: true }).fill("2026");
	await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "今日",
		exact: true,
	}).click();
	const recent = page.getByRole("region", { name: "最近編集した項目" }).getByRole("button", {
		name: /mock-7/,
	});
	await recent.click();
	const dialog = page.getByRole("dialog", { name: "年代の変更を保存しますか？" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole("region", { name: "今日", exact: true })).toBeVisible();
	await expect(
		page.getByRole("complementary").getByRole("heading", {
			name: "mock-1 editable text",
			exact: true,
		}),
	).toBeVisible();
	await recent.click();
	await dialog.getByRole("button", { name: "破棄して移動", exact: true }).click();
	await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-7");
	const back = page.getByRole("button", { name: "前の画面へ戻る", exact: true });
	await back.click();
	await expect(page.getByRole("region", { name: "今日", exact: true })).toBeVisible();
	await expect(
		page.getByRole("complementary").getByRole("heading", {
			name: "mock-1 editable text",
			exact: true,
		}),
	).toBeVisible();
	await back.click();
	await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-1");
	await expect(back).toBeDisabled();
});

for (const choice of ["保存して移動", "破棄して移動", "キャンセル"] as const) {
	test(`Back waits for the historical-time guard: ${choice}`, async ({ page }) => {
		await page.route("**/api/rpc/projectDates", (route) =>
			route.fulfill({
				json: {
					result: {
						range: { startInclusive: "2026-09-05", endExclusive: "2026-09-06" },
						created: [],
						updated: [],
					},
				},
			}));
		await page.route(
			"**/api/rpc/setWorkHistoricalTime",
			(route) => route.fulfill({ json: { result: null } }),
		);
		await page.goto("/");
		await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
		await page.keyboard.press("Control+Shift+H");
		await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
			name: "今日",
			exact: true,
		}).click();
		await page.getByRole("region", { name: "最近編集した項目" }).getByRole("button", {
			name: /mock-7/,
		}).click();
		await page.getByRole("textbox", { name: "年", exact: true }).fill("2026");
		const back = page.getByRole("button", { name: "前の画面へ戻る", exact: true });
		await back.click();
		const dialog = page.getByRole("dialog", { name: "年代の変更を保存しますか？" });
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: choice, exact: true }).click();
		if (choice === "キャンセル") {
			await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-7");
			await expect(page.getByRole("textbox", { name: "年", exact: true })).toHaveValue("2026");
			await expect(back).toBeEnabled();
			await back.click();
			await dialog.getByRole("button", { name: "破棄して移動", exact: true }).click();
		}
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole("region", { name: "今日", exact: true })).toBeVisible();
		await expect(
			page.getByRole("complementary").getByRole("heading", {
				name: "mock-1 editable text",
				exact: true,
			}),
		).toBeVisible();
		await back.click();
		await expect(page.locator('textarea[data-item-id="mock-1"]')).toBeFocused();
		await expect(page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]')).toHaveCount(
			0,
		);
		await expect(back).toBeDisabled();
	});
}

for (const kind of ["work", "revision"] as const) {
	test(`${kind} comparison restores an edited and swapped pair after leaving the screen`, async ({ page }) => {
		const revisions = ["a", "b", "c"].map((id) => ({
			id,
			workId: "mock-7",
			text: `body ${id}`,
			parentRevisionIds: [],
			kind: "checkpoint",
			createdAt: "2026-09-05T00:00:00.000Z",
			message: id,
		}));
		await page.route(
			"**/api/rpc/listRevisions",
			(route) => route.fulfill({ json: { result: revisions } }),
		);
		await page.route("**/api/rpc/listWorkLineage", (route) =>
			route.fulfill({
				json: {
					result: {
						work: {
							id: "mock-7",
							createdAt: revisions[0].createdAt,
							updatedAt: revisions[0].createdAt,
						},
						branches: [],
						revisions,
					},
				},
			}));
		await page.route(
			"**/api/rpc/listWorkComparisonDocuments",
			(route) =>
				route.fulfill({
					json: {
						result: {
							workId: "mock-7",
							documents: revisions.map((revision) => ({
								scope: "revision",
								workId: revision.workId,
								revisionId: revision.id,
								title: revision.message,
								text: revision.text,
							})),
						},
					},
				}),
		);
		await page.goto("/");
		await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
		await page.getByRole("tab", { name: "履歴", exact: true }).click();
		if (kind === "work") {
			await page.getByRole("button", { name: "版の履歴を開く", exact: true }).click();
			await page.getByRole("button", { name: "この版を比較", exact: true }).last().click();
		} else {
			await page.getByRole("button", { name: "版比較を開く", exact: true }).click();
		}
		const left = page.locator("#comparison-left");
		const right = page.locator("#comparison-right");
		await left.selectOption("revision:b");
		await right.selectOption("revision:a");
		await left.selectOption("revision:a");
		await expect(right).toHaveValue("revision:b");
		await page.getByRole("button", { name: "Option", exact: true }).click();
		await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
		await expect(left).toHaveValue("revision:a");
		await expect(right).toHaveValue("revision:b");
	});
}

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

test("screen back focuses the selected tree node instead of the first node", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	const node = page.locator(".tree-node").nth(1);
	await node.focus();
	await node.press("Enter");
	await expect(node).toHaveClass(/selected/);
	const nodeId = await node.getAttribute("data-tree-node-id");
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "前の画面へ戻る", exact: true }).click();
	await expect(page.locator(`.tree-node[data-tree-node-id="${nodeId}"]`)).toBeFocused();
});

test("Alt+Left is suppressed while a dialog is open", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await page.keyboard.press("Control+K");
	await expect(page.getByRole("dialog", { name: "コマンドパレット" })).toBeVisible();
	const prevented = await page.evaluate(() => {
		const event = new KeyboardEvent("keydown", {
			key: "ArrowLeft",
			altKey: true,
			bubbles: true,
			cancelable: true,
		});
		window.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(true);
	await expect(page.getByRole("dialog", { name: "コマンドパレット" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("heading", { name: "Option", exact: true })).toBeVisible();
});
