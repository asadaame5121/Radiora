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
	page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
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

test("Option and nested trash return directly to the retained Outline", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
	await expect(back).toBeDisabled();
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await page.getByRole("button", { name: "項目を復元する", exact: true }).click();
	await back.click();
	await expect(page.locator('textarea[data-item-id="mock-7"]')).toBeFocused();
	await expect(back).toBeDisabled();
});

test("Tree selection and Help do not overwrite suspended Outline Hoist or caret", async ({ page }) => {
	await page.goto("/");
	const editor = page.locator('textarea[data-item-id="mock-1"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
	await page.keyboard.press("Control+Shift+H");
	await editor.evaluate((element: HTMLTextAreaElement) =>
		element.setSelectionRange(element.value.length, element.value.length)
	);
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeVisible();
	const node = page.locator(".tree-node").nth(1);
	await node.focus();
	await node.press("Enter");
	await expect(node).toHaveClass(/selected/);
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "ナビゲーションを閉じる" }).click();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(editor).toBeFocused();
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]')).toHaveCount(0);
	expect(
		await editor.evaluate((
			element: HTMLTextAreaElement,
		) => [element.selectionStart, element.selectionEnd]),
	).toEqual([items[0].text.length, items[0].text.length]);
});

test("every primary screen resumes the same Outline", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	const navigation = page.getByRole("navigation", { name: "主な画面" });
	for (const name of ["今日", "未配置項目", "未完成項目一覧", "重複候補", "タグ管理", "Option"]) {
		await navigation.getByRole("button", { name, exact: true }).click();
		await expect(page.getByRole("button", { name: "アウトラインに戻る", exact: true }))
			.toBeEnabled();
		await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
		await expect(page.locator('textarea[data-item-id="mock-7"]')).toBeFocused();
	}
});

test("Query changes the inspector without enabling screen Back", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await page.getByRole("button", { name: "Query・検索別名", exact: true }).click();
	await expect(page.locator(".query-panel")).toBeVisible();
	const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
	await expect(back).toBeDisabled();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await back.click();
	await expect(page.locator(".query-panel")).toBeVisible();
	await expect(page.locator('textarea[data-item-id="mock-7"]')).toBeFocused();
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
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
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

for (const choice of ["保存して移動", "破棄して移動", "キャンセル"] as const) {
	test(`Outline resume waits for the guard: ${choice}`, async ({ page }) => {
		await page.route(
			"**/api/rpc/setWorkHistoricalTime",
			(route) => route.fulfill({ json: { result: null } }),
		);
		await page.goto("/");
		await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
		await page.keyboard.press("Control+Shift+H");
		await page.getByRole("button", { name: "ツリー", exact: true }).click();
		await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeVisible();
		const node = page.locator(".tree-node").nth(1);
		await node.focus();
		await node.press("Enter");
		await page.getByRole("button", { name: "今日", exact: true }).click();
		await page.getByRole("textbox", { name: "年", exact: true }).fill("2026");
		const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
		await back.click();
		const dialog = page.getByRole("dialog", { name: "年代の変更を保存しますか？" });
		await expect(dialog).toBeVisible();
		await expect(page.getByRole("region", { name: "今日", exact: true })).toBeVisible();
		await dialog.getByRole("button", { name: choice, exact: true }).click();
		if (choice === "キャンセル") {
			await expect(page.getByRole("region", { name: "今日", exact: true })).toBeVisible();
			await expect(page.getByRole("textbox", { name: "年", exact: true })).toHaveValue("2026");
			await back.click();
			await dialog.getByRole("button", { name: "破棄して移動", exact: true }).click();
		}
		await expect(page.locator('textarea[data-item-id="mock-1"]')).toBeFocused();
		await expect(page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]')).toHaveCount(
			0,
		);
		await expect(back).toBeDisabled();
	});
}
for (const operation of ["place", "root capture"] as const) {
	for (const choice of ["保存して移動", "破棄して移動", "キャンセル"] as const) {
		test(`${operation} defers navigation until the selection guard resolves: ${choice}`, async ({ page }) => {
			const created = {
				...items[1],
				id: "created",
				workId: "created",
				text: "created work",
				revisionSelector: { mode: "branch", branchId: "created-main" },
			};
			let snapshotItems = [...items];
			let unplaced = [{
				workId: created.workId,
				branchId: "created-main",
				text: created.text,
				createdAt: created.createdAt,
				updatedAt: created.updatedAt,
			}];
			await page.route(
				"**/api/rpc/listOutline",
				(route) =>
					route.fulfill({
						json: { result: { items: snapshotItems, links: [], knots: [], stashItemIds: [] } },
					}),
			);
			await page.route(
				"**/api/rpc/listUnplacedWorks",
				(route) => route.fulfill({ json: { result: unplaced } }),
			);
			for (const method of ["placeUnplacedWork", "createItem"]) {
				await page.route(`**/api/rpc/${method}`, (route) => {
					snapshotItems = [...items, created];
					if (method === "placeUnplacedWork") unplaced = [];
					return route.fulfill({ json: { result: created } });
				});
			}
			await page.route(
				"**/api/rpc/setWorkHistoricalTime",
				(route) => route.fulfill({ json: { result: null } }),
			);
			await page.goto("/");
			await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
			await page.keyboard.press("Control+Shift+H");
			await page.getByRole("textbox", { name: "年", exact: true }).fill("2026");
			await page.getByRole("button", { name: "未配置項目", exact: true }).click();
			await page.getByRole("textbox", { name: "テキストで絞り込み", exact: true }).fill("work");
			if (operation === "place") {
				await page.getByRole("button", { name: "Rootへ配置", exact: true }).click();
			} else {
				const input = page.getByRole("combobox", { name: "検索・クイック入力", exact: true });
				await input.fill(created.text);
				await input.press("Shift+Enter");
			}
			const dialog = page.getByRole("dialog", { name: "年代の変更を保存しますか？" });
			await expect(dialog).toBeVisible();
			await expect(page.locator(".unplaced-inbox")).toBeVisible();
			await dialog.getByRole("button", { name: choice, exact: true }).click();
			await expect(dialog).toHaveCount(0);
			const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
			if (choice === "キャンセル") {
				await expect(page.getByRole("region", { name: "未配置項目", exact: true })).toBeVisible();
				await expect(page.getByRole("textbox", { name: "年", exact: true })).toHaveValue("2026");
				await back.click();
				await expect(page.locator('textarea[data-item-id="mock-1"]')).toBeFocused();
			} else {
				await expect(page.locator('textarea[data-item-id="created"]')).toBeFocused();
				await expect(back).toBeDisabled();
				await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
				await back.click();
				await expect(page.locator('textarea[data-item-id="created"]')).toBeFocused();
			}
			await expect(back).toBeDisabled();
		});
	}
}

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

for (const composition of ["isComposing", "keyCode"] as const) {
	test(`Alt+Left is suppressed without navigating during IME: ${composition}`, async ({ page }) => {
		await page.goto("/");
		await page.getByRole("button", { name: "Option", exact: true }).click();
		const prevented = await page.evaluate((kind) => {
			const event = new KeyboardEvent("keydown", {
				key: "ArrowLeft",
				altKey: true,
				bubbles: true,
				cancelable: true,
				isComposing: kind === "isComposing",
				keyCode: kind === "keyCode" ? 229 : 0,
			});
			window.dispatchEvent(event);
			return event.defaultPrevented;
		}, composition);
		expect(prevented).toBe(true);
		await expect(page.getByRole("heading", { name: "Option", exact: true })).toBeVisible();
		await page.keyboard.press("Alt+ArrowLeft");
		await expect(page.getByRole("tree")).toBeVisible();
		await expect(page.getByRole("button", { name: "アウトラインに戻る", exact: true }))
			.toBeDisabled();
	});
}

test("a delayed comparison cannot replace Help or add an obsolete caller to history", async ({ page }) => {
	const revision = {
		id: "pending",
		workId: "mock-7",
		text: "pending comparison",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: items[1].createdAt,
		message: "pending",
	};
	await page.route(
		"**/api/rpc/listRevisions",
		(route) => route.fulfill({ json: { result: [revision] } }),
	);
	await page.route("**/api/rpc/listWorkLineage", (route) =>
		route.fulfill({
			json: {
				result: {
					work: { id: "mock-7", createdAt: items[1].createdAt, updatedAt: items[1].updatedAt },
					branches: [],
					revisions: [revision],
				},
			},
		}));
	let release!: () => void;
	let requested = false;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/rpc/listWorkComparisonDocuments", async (route) => {
		requested = true;
		await pending;
		await route.fulfill({
			json: {
				result: {
					workId: "mock-7",
					documents: [{
						scope: "revision",
						workId: "mock-7",
						revisionId: "pending",
						title: "pending",
						text: "pending comparison",
					}],
				},
			},
		});
	});
	try {
		await page.goto("/");
		await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
		await page.getByRole("tab", { name: "履歴", exact: true }).click();
		await page.getByRole("button", { name: "版の履歴を開く", exact: true }).click();
		await page.getByRole("button", { name: "この版を比較", exact: true }).click();
		await expect.poll(() => requested).toBe(true);
		await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
		const response = page.waitForResponse("**/api/rpc/listWorkComparisonDocuments");
		release();
		await response;
		await page.evaluate(() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			})
		);
		await expect(page.locator(".help-panel")).toBeVisible();
		const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
		await back.click();
		await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-7");
		await expect(back).toBeDisabled();
	} finally {
		release();
	}
});

test("last row caret and a scrolled Outline survive resume after Help", async ({ page }) => {
	const rows = Array.from({ length: 45 }, (_, index) => ({
		...items[0],
		id: `scroll-${index}`,
		workId: `scroll-${index}`,
		text: `row ${index} with editable content`,
		parentId: index === 0 ? null : "scroll-0",
		orderKey: index,
		revisionSelector: { mode: "branch", branchId: `scroll-${index}-main` },
	}));
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: { result: { items: rows, links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="scroll-0"]').click();
	await page.keyboard.press("Control+Shift+H");
	await page.locator('.markdown-editor-host[data-editor-item-id="scroll-44"]').click();
	const editor = page.locator('textarea[data-item-id="scroll-44"]');
	await editor.evaluate((element: HTMLTextAreaElement) =>
		element.setSelectionRange(element.value.length, element.value.length, "backward")
	);
	const scrollTop = await page.locator(".outline-panel").evaluate((element) => element.scrollTop);
	expect(scrollTop).toBeGreaterThan(0);
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(editor).toBeFocused();
	expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(
		rows[44].text.length,
	);
	await expect.poll(() => page.locator(".outline-panel").evaluate((element) => element.scrollTop))
		.toBe(scrollTop);
	await expect(page.getByRole("button", { name: "ここだけ表示を解除", exact: true })).toBeVisible();
});

test("manuscript display and caret survive leaving and resuming Outline", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await page.getByRole("button", { name: "原稿として開く", exact: true }).click();
	const manuscript = page.locator(".long-form-textarea");
	await expect(manuscript).toBeFocused();
	await manuscript.evaluate((element: HTMLTextAreaElement) =>
		element.setSelectionRange(3, 7, "backward")
	);
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(manuscript).toBeFocused();
	expect(
		await manuscript.evaluate((
			element: HTMLTextAreaElement,
		) => [element.selectionStart, element.selectionEnd, element.selectionDirection]),
	).toEqual([3, 7, "backward"]);
});

test("F1 navigation preserves manuscript edits entered while async save is in-flight", async ({ page }) => {
	let currentText = "mock-7 editable text";
	let saveBlocked: (() => void) | null = null;
	const saveGate = new Promise<void>((resolve) => {
		saveBlocked = resolve;
	});

	await page.route("**/api/rpc/updateItemText", async (route) => {
		const request = route.request().postDataJSON() as { args?: string[] };
		if (request?.args?.[1]) {
			currentText = request.args[1];
		}
		await saveGate;
		await route.fulfill({ json: { result: null } });
	});
	await page.route("**/api/rpc/listOutline", (route) => {
		const updatedItems = items.map((item) =>
			item.id === "mock-7" ? { ...item, text: currentText } : item
		);
		return route.fulfill({
			json: { result: { items: updatedItems, links: [], knots: [], stashItemIds: [] } },
		});
	});

	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await page.getByRole("button", { name: "原稿として開く", exact: true }).click();
	const manuscript = page.locator(".long-form-textarea");
	await expect(manuscript).toBeFocused();

	// Type initial text in manuscript
	await manuscript.fill("Text A");
	await manuscript.focus();

	// Press F1 to start navigation to Help
	await page.keyboard.press("F1");

	// While save is in-flight behind saveGate, type additional text
	await manuscript.evaluate((el: HTMLTextAreaElement) => {
		el.value = "Text A and B";
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});

	// Unblock save
	saveBlocked?.();

	// Help panel opens
	await expect(page.locator(".help-panel")).toBeVisible();

	// Click Back to Outline
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();

	// Manuscript re-mounts and retains Text A and B
	await expect(manuscript).toBeFocused();
	await expect(manuscript).toHaveValue("Text A and B");
});

test("failed Outline retrieval leaves Help open and a subsequent resume succeeds", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.route(
		"**/api/rpc/listOutline",
		(route) => route.fulfill({ status: 500, json: { error: "offline" } }),
		{ times: 1 },
	);
	const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
	await back.click();
	await expect(page.locator(".error")).toContainText("API request failed");
	await expect(page.locator(".help-panel")).toBeVisible();
	await back.click();
	await expect(page.locator('textarea[data-item-id="mock-7"]')).toBeFocused();
});

test("resume uses latest text and clamps the caret without undoing a data change", async ({ page }) => {
	let current = [...items];
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({
				json: { result: { items: current, links: [], knots: [], stashItemIds: [] } },
			}),
	);
	await page.goto("/");
	const editor = page.locator('textarea[data-item-id="mock-7"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await editor.evaluate((element: HTMLTextAreaElement) =>
		element.setSelectionRange(element.value.length, element.value.length)
	);
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	current = items.map((item) => item.id === "mock-7" ? { ...item, text: "短い" } : item);
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(editor).toHaveValue("短い");
	await expect(editor).toBeFocused();
	expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(2);
});

test("rewriting a branch creates an explicit Outline destination for subsequent resume", async ({ page }) => {
	const source = items[0];
	const placement = {
		...source,
		id: "rewritten-placement",
		revisionSelector: { mode: "branch", branchId: "rewritten-branch" },
		contextualHeading: "rewritten branch",
	};
	let snapshotItems = [...items];
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items: snapshotItems, links: [], knots: [], stashItemIds: [] } },
		}));
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
	await page.route("**/api/rpc/rewriteAsNewBranch", (route) =>
		route.fulfill({
			json: {
				result: { status: "created", branch: { id: "rewritten-branch", name: "rewritten branch" } },
			},
		}));
	await page.route("**/api/rpc/createOccurrence", (route) => {
		snapshotItems = [...items, placement];
		return route.fulfill({ json: { result: placement } });
	});
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
	await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "今日",
		exact: true,
	}).click();
	await page.getByRole("textbox", { name: "テキストで絞り込み", exact: true }).fill(
		"",
	);
	await page.keyboard.press("Control+Shift+S");
	const dialog = page.getByRole("dialog", { name: "新しい別稿として書き直しますか？" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox").fill("rewritten branch");
	await dialog.getByRole("button", { name: "新しい別稿を作る", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByRole("complementary").getByRole("heading", {
			name: "rewritten branch",
			exact: true,
		}),
	).toBeVisible();
	const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
	await expect(back).toBeDisabled();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await back.click();
	await expect(page.locator('textarea[data-item-id="rewritten-placement"]')).toBeFocused();
	await expect(back).toBeDisabled();
});

for (
	const action of [
		"アウトラインで開く",
		"この位置へZoom",
		"版の履歴を開く",
		"原稿として開く",
		"版比較を開く",
	]
) {
	test(`Tree context-menu destination uses the common gateway: ${action}`, async ({ page }) => {
		await page.goto("/");
		await page.locator('.markdown-editor-host[data-editor-item-id="mock-1"]').click();
		await page.getByRole("button", { name: "ツリー", exact: true }).click();
		const node = page.locator(".tree-node").nth(1);
		await node.focus();
		await node.press("Enter");
		await node.press("Shift+F10");
		const command = page.getByRole("menuitem", { name: action, exact: true });
		await command.focus();
		await command.press("Enter");
		await expect(page.getByRole("group", { name: "思索の系統樹" })).toHaveCount(0);
		const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
		const explicit = ["アウトラインで開く", "この位置へZoom", "原稿として開く"].includes(action);
		if (explicit) {
			await expect(back).toBeDisabled();
			await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
		}
		await back.click();
		if (action === "原稿として開く") {
			await expect(page.locator(".long-form-textarea")).toBeFocused();
			await expect(
				page.getByRole("complementary").getByRole("heading", {
					name: "mock-7 editable text",
					exact: true,
				}),
			).toBeVisible();
		} else {
			await expect(page.getByRole("treeitem", { selected: true })).toContainText(
				explicit ? "mock-7" : "mock-1",
			);
		}
		await expect(back).toBeDisabled();
	});
}

test("row focus survives toolbar blur independently of the selected item", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	await page.locator(".rows").focus();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(page.locator(".rows")).toBeFocused();
	await expect(page.getByRole("treeitem", { selected: true })).toContainText("mock-7");
});

test("an empty Outline restores its first-item focus without creating an item", async ({ page }) => {
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: { result: { items: [], links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.goto("/");
	await page.locator(".first-item").focus();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(page.locator(".first-item")).toBeFocused();
	await expect(page.getByRole("treeitem")).toHaveCount(0);
});

test("Return to Editor restores remembered caret and panel scroll after another Tree selection", async ({ page }) => {
	const rows = Array.from({ length: 45 }, (_, index) => ({
		...items[0],
		id: `scroll-${index}`,
		workId: `scroll-${index}`,
		text: `row ${index} with editable content`,
		parentId: index === 0 ? null : "scroll-0",
		orderKey: index,
		revisionSelector: { mode: "branch", branchId: `scroll-${index}-main` },
	}));
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: { result: { items: rows, links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="scroll-0"]').click();
	await page.keyboard.press("Control+Shift+H");
	await page.locator('.markdown-editor-host[data-editor-item-id="scroll-44"]').click();
	const editor = page.locator('textarea[data-item-id="scroll-44"]');
	await editor.evaluate((element: HTMLTextAreaElement) =>
		element.setSelectionRange(element.value.length, element.value.length, "backward")
	);
	const scrollTop = await page.locator(".outline-panel").evaluate((element) => element.scrollTop);
	expect(scrollTop).toBeGreaterThan(0);
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	const node = page.locator(".tree-node").nth(1);
	await node.focus();
	await node.press("Enter");
	await page.keyboard.press("Control+/");
	await page.keyboard.press("b");
	await expect(editor).toBeFocused();
	expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(
		rows[44].text.length,
	);
	await expect.poll(() => page.locator(".outline-panel").evaluate((element) => element.scrollTop))
		.toBe(scrollTop);
	await expect(page.getByRole("button", { name: "ここだけ表示を解除", exact: true })).toBeVisible();
});

test("an explicit offscreen target scrolls into view instead of restoring panel position zero", async ({ page }) => {
	const rows = Array.from({ length: 45 }, (_, index) => ({
		...items[0],
		id: `scroll-${index}`,
		workId: `scroll-${index}`,
		text: `row ${index} with editable content`,
		parentId: index === 0 ? null : "scroll-0",
		orderKey: index,
		revisionSelector: { mode: "branch", branchId: `scroll-${index}-main` },
	}));
	rows[44] = { ...rows[44], updatedAt: "2026-10-04T00:00:00.000Z" };
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: { result: { items: rows, links: [], knots: [], stashItemIds: [] } } }),
	);

	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="scroll-0"]').click();
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("region", { name: "最近編集した項目" }).getByRole("button", {
		name: /row 44 with editable content/,
	}).click();

	const editor = page.locator('textarea[data-item-id="scroll-44"]');
	await expect(editor).toBeFocused();
	await expect(editor).toBeInViewport();
	expect(await page.locator(".outline-panel").evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
});

test("an existing empty row resumes at caret zero without creating another occurrence", async ({ page }) => {
	const emptyRows = items.map((item) => item.id === "mock-7" ? { ...item, text: "" } : item);
	let created = false;
	await page.route("**/api/rpc/createItem", (route) => {
		created = true;
		return route.fulfill({ json: { result: items[0] } });
	});
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({
				json: { result: { items: emptyRows, links: [], knots: [], stashItemIds: [] } },
			}),
	);
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="mock-7"]').click();
	const editor = page.locator('textarea[data-item-id="mock-7"]');
	await expect(editor).toHaveValue("");
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(editor).toBeFocused();
	expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);
	await expect(page.getByRole("treeitem")).toHaveCount(2);
	expect(created).toBe(false);
});
