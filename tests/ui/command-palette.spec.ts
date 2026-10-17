import { expect, test } from "@playwright/test";

const items = ["palette-item-1", "palette-item-2"].map((id, index) => ({
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
	await page.route("**/api/rpc/listBookmarks", (route) => route.fulfill({ json: { result: [] } }));
});

test("Ctrl+K opens the real palette and its query filters the command projection", async ({ page }) => {
	await page.goto("/");
	const editor = page.locator('textarea[data-item-id="palette-item-1"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await expect(editor).toBeFocused();
	await editor.pressSequentially("x");
	await expect(editor).toHaveValue(`${items[0].text}x`);

	await page.keyboard.press("Control+k");
	const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
	const input = page.getByRole("combobox", { name: "コマンドパレット" });
	await expect(dialog).toBeVisible();
	await expect(input).toBeFocused();
	const paletteInput = await input.elementHandle();
	await expect(page.getByRole("button", { name: "コマンドパレットを開く", exact: true }))
		.toHaveCount(0);

	await input.pressSequentially("栞");
	await expect(input).toBeFocused();
	expect(await input.evaluate((element, original) => element === original, paletteInput)).toBe(
		true,
	);
	const options = dialog.getByRole("option");
	await expect(options).toHaveCount(1);
	await expect(options.filter({ hasText: /^栞/ })).toBeVisible();
	await input.fill("no matching palette command");
	await expect(input).toBeFocused();
	expect(await input.evaluate((element, original) => element === original, paletteInput)).toBe(
		true,
	);
	await expect(dialog.getByRole("status")).toContainText("一致するコマンドはありません。");
	await expect(options).toHaveCount(0);
	await input.clear();
	await expect(options.filter({ hasText: /^栞/ })).toBeVisible();
	await expect(dialog.getByRole("option", { name: "クイック入力 Ctrl+Shift+Enter" }))
		.toBeVisible();

	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(editor).toBeFocused();
	await page.keyboard.press("Control+k");
	await expect(dialog).toBeVisible();
	await expect(input).toHaveValue("");
});

for (const closeWith of ["Escape", "outside click", "Ctrl+K toggle"] as const) {
	test(`closing the palette with ${closeWith} restores the editor focus and caret`, async ({ page }) => {
		await page.goto("/");
		const editor = page.locator('textarea[data-item-id="palette-item-1"]');
		const host = page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]');
		await host.click();
		await expect(editor).toBeFocused();
		const originalEditor = await editor.elementHandle();
		const originalHost = await host.elementHandle();
		await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 7));
		await page.keyboard.press("Control+k");
		const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
		await expect(page.getByRole("combobox", { name: "コマンドパレット" })).toBeFocused();

		if (closeWith === "Escape") {
			await page.keyboard.press("Escape");
		} else if (closeWith === "outside click") {
			await page.mouse.click(5, 5);
		} else {
			await page.keyboard.press("Control+k");
		}

		await expect(dialog).toHaveCount(0);
		await expect(editor).toBeFocused();
		expect(
			await editor.evaluate(
				(element, original) => element === original && Boolean(original?.isConnected),
				originalEditor,
			),
		).toBe(true);
		expect(
			await host.evaluate(
				(element, original) => element === original && Boolean(original?.isConnected),
				originalHost,
			),
		).toBe(true);
		expect(
			await editor.evaluate((
				element: HTMLTextAreaElement,
			) => [element.selectionStart, element.selectionEnd]),
		).toEqual([3, 7]);
	});
}

test("executed command focus takes precedence over the closed palette return target", async ({ page }) => {
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.keyboard.press("Control+k");
	const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
	await dialog.getByRole("option", { name: "関係を追加", exact: true }).click();

	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole("tab", { name: "関係", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("searchbox", { name: "接続先を検索" })).toBeFocused();
});

test("palette command executes through App and disabled command exposes its reason without an RPC", async ({ page }) => {
	const bookmarkCalls: unknown[][] = [];
	let bookmarked = false;
	const bookmarkRecord = {
		id: "palette-bookmark",
		workId: items[0].workId,
		occurrenceId: items[0].id,
		createdAt: "now",
	};
	let promoteCalls = 0;
	await page.route(
		"**/api/rpc/listBookmarks",
		(route) => route.fulfill({ json: { result: bookmarked ? [bookmarkRecord] : [] } }),
	);
	await page.route("**/api/rpc/createBookmark", (route) => {
		bookmarkCalls.push(route.request().postDataJSON().args);
		bookmarked = true;
		return route.fulfill({ json: { result: bookmarkRecord } });
	});
	await page.route("**/api/rpc/promoteRecoverySnapshot", (route) => {
		promoteCalls++;
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.keyboard.press("Control+k");
	const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
	const bookmark = dialog.getByRole("option", { name: /^栞/ });
	await expect(bookmark).toBeEnabled();
	await bookmark.click();
	await expect(dialog).toHaveCount(0);
	await expect.poll(() => bookmarkCalls).toEqual([[items[0].id]]);
	await expect(page.getByRole("button", { name: "栞を削除", exact: true })).toBeVisible();

	await page.keyboard.press("Control+k");
	const revision = page.getByRole("dialog", { name: "コマンドパレット" })
		.getByRole("option", { name: "バージョンとして保存", exact: true });
	await expect(revision).toBeDisabled();
	await expect(revision).toHaveAttribute("title", "保存する復元ポイントを選択してください。");
	await revision.click({ force: true });
	await expect.poll(() => promoteCalls).toBe(0);
	await expect(page.getByRole("dialog", { name: "コマンドパレット" })).toBeVisible();
});

test("unrelated global shortcut is suppressed while the palette is open", async ({ page }) => {
	let bookmarkCalls = 0;
	await page.route("**/api/rpc/createBookmark", (route) => {
		bookmarkCalls++;
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/");
	const editor = page.locator('textarea[data-item-id="palette-item-1"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.keyboard.press("Control+k");
	const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Control+Shift+H");
	await expect(dialog).toBeVisible();
	await expect(page.getByRole("combobox", { name: "コマンドパレット" })).toBeFocused();
	await expect(page.locator(".long-form-editor")).toHaveCount(0);
	await page.keyboard.press("Control+Shift+B");
	await expect(dialog).toBeVisible();
	expect(bookmarkCalls).toBe(0);
	await page.keyboard.press("Escape");
	await expect(editor).toBeFocused();
});

test("canceling the App rewrite confirmation does not call the rewrite API", async ({ page }) => {
	let rewriteCalls = 0;
	await page.route("**/api/rpc/rewriteAsNewBranch", (route) => {
		rewriteCalls++;
		return route.fulfill({
			json: { result: { status: "created", branch: { id: "unexpected", name: "unexpected" } } },
		});
	});
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.keyboard.press("Control+k");
	const palette = page.getByRole("dialog", { name: "コマンドパレット" });
	await palette.getByRole("option", { name: /^別稿として保存/ }).click();

	const confirmation = page.getByRole("dialog", { name: "新しい別稿として書き直しますか？" });
	await expect(confirmation).toBeVisible();
	await expect(confirmation.getByRole("textbox", { name: "別稿名" })).toBeFocused();
	await confirmation.getByRole("button", { name: "キャンセル", exact: true }).click();
	await expect(confirmation).toHaveCount(0);
	expect(rewriteCalls).toBe(0);
});

test("quick-capture shortcut creates and renders the App's root-capture result", async ({ page }) => {
	const created = {
		...items[0],
		id: "quick-capture-created",
		workId: "quick-capture-work",
		text: "captured from the OmniWindow",
		orderKey: 2,
		revisionSelector: { mode: "branch" as const, branchId: "quick-capture-branch" },
	};
	let snapshotItems = [...items];
	const createCalls: unknown[][] = [];
	await page.addInitScript(() => {
		localStorage.setItem("radiora.quickCapturePreference", JSON.stringify({ destination: "root" }));
	});
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items: snapshotItems, links: [], knots: [], stashItemIds: [] } },
		}));
	for (const method of ["suggestItems", "searchItems"]) {
		await page.route(`**/api/rpc/${method}`, (route) => route.fulfill({ json: { result: [] } }));
	}
	await page.route("**/api/rpc/createItem", (route) => {
		createCalls.push(route.request().postDataJSON().args);
		snapshotItems = [...items, created];
		return route.fulfill({ json: { result: created } });
	});
	await page.goto("/");

	const input = page.getByRole("combobox", { name: "検索・クイック入力", exact: true });
	await input.fill(created.text);
	await expect(input).toHaveValue(created.text);
	const captureOption = page.getByRole("option", { name: new RegExp(created.text) });
	await expect(captureOption).toBeEnabled();
	await input.press("Control+Shift+Enter");

	await expect.poll(() => createCalls).toEqual([[
		{ text: created.text, parentId: null, afterId: items[1].id },
	]]);
	await expect(input).toHaveValue("");
	const editor = page.locator('textarea[data-item-id="quick-capture-created"]');
	await expect(editor).toHaveValue(created.text);
	await expect(editor).toBeFocused();
});

test("LinkEditor submits the selected target, type, direction, and reason through App to createLink", async ({ page }) => {
	const searchRequests: unknown[][] = [];
	const createLinkCalls: unknown[][] = [];
	let outlineLinks: unknown[] = [];
	await page.route("**/api/rpc/searchItems", (route) => {
		searchRequests.push(route.request().postDataJSON().args);
		return route.fulfill({
			json: {
				result: [{
					item: items[1],
					ancestorIds: [],
					score: 1,
					reasons: [{ kind: "title", label: "タイトル一致", score: 1 }],
				}],
			},
		});
	});
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({
			json: { result: { items, links: outlineLinks, knots: [], stashItemIds: [] } },
		}));
	await page.route("**/api/rpc/createLink", (route) => {
		createLinkCalls.push(route.request().postDataJSON().args);
		outlineLinks = [{
			id: "created-link",
			fromId: items[1].workId,
			toId: items[0].workId,
			from: { scope: "work", workId: items[1].workId },
			to: { scope: "work", workId: items[0].workId },
			type: "FROM",
			status: "asserted",
			origin: "human",
			createdAt: "2026-10-12T00:00:00.000Z",
		}];
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.keyboard.press("Control+k");
	const palette = page.getByRole("dialog", { name: "コマンドパレット" });
	await palette.getByRole("option", { name: "関係を追加", exact: true }).click();

	const editor = page.locator(".link-editor");
	await expect(editor.locator(".link-editor-context")).toHaveText(
		"選択中: palette-item-1 editable text",
	);
	const selectors = editor.getByRole("combobox");
	await selectors.nth(0).selectOption("FROM");
	await selectors.nth(1).selectOption("incoming");
	await editor.getByPlaceholder("この関係の理由").fill("because");
	const search = editor.getByRole("searchbox", { name: "接続先を検索" });
	await search.fill("palette-item-2");
	await expect.poll(() => searchRequests).toEqual([[
		{ query: "palette-item-2", contextItemId: items[0].workId, limit: 16 },
	]]);
	const target = editor.getByRole("button", { name: /palette-item-2 editable text/ });
	await expect(target).toBeEnabled();
	await target.click();

	await expect.poll(() => createLinkCalls).toEqual([[
		{
			fromId: items[1].workId,
			toId: items[0].workId,
			type: "FROM",
			reason: "because",
		},
	]]);
	await expect(editor.locator(".link-editor-list")).toContainText("palette-item-2 editable text");
	await expect(editor.locator(".link-editor-list")).toContainText("FROM ←");
});

test("promoting a selected recovery snapshot sends its ID through the App command gateway", async ({ page }) => {
	const workId = items[0].workId;
	const branchId = items[0].revisionSelector.branchId;
	const snapshot = {
		id: "selected-recovery-snapshot",
		workId,
		branchId,
		text: "saved recovery content",
		contentHash: "snapshot-hash",
		createdAt: "2026-10-12T00:00:00.000Z",
		sourceRevisionId: null,
		name: "chosen snapshot",
	};
	let revisions: unknown[] = [];
	const previewCalls: unknown[][] = [];
	const promoteCalls: unknown[][] = [];
	const lineage = () => ({
		work: {
			id: workId,
			createdAt: "2026-10-01T00:00:00.000Z",
			updatedAt: "2026-10-12T00:00:00.000Z",
		},
		branches: [{
			id: branchId,
			workId,
			name: "main",
			headRevisionId: null,
			createdAt: "2026-10-01T00:00:00.000Z",
		}],
		revisions,
	});
	await page.route(
		"**/api/rpc/listRecoverySnapshots",
		(route) => route.fulfill({ json: { result: [snapshot] } }),
	);
	await page.route(
		"**/api/rpc/listRevisions",
		(route) => route.fulfill({ json: { result: revisions } }),
	);
	await page.route(
		"**/api/rpc/listWorkLineage",
		(route) => route.fulfill({ json: { result: lineage() } }),
	);
	await page.route("**/api/rpc/previewRecoverySnapshot", (route) => {
		previewCalls.push(route.request().postDataJSON().args);
		return route.fulfill({
			json: {
				result: {
					snapshot,
					workingCopy: {
						workId,
						branchId,
						text: "current content",
						updatedAt: "2026-10-12T00:00:00.000Z",
					},
					diff: [{ kind: "add", text: "saved recovery content" }],
				},
			},
		});
	});
	await page.route("**/api/rpc/promoteRecoverySnapshot", (route) => {
		promoteCalls.push(route.request().postDataJSON().args);
		revisions = [{
			id: "promoted-revision",
			workId,
			text: snapshot.text,
			parentRevisionIds: [],
			kind: "edition",
			createdAt: "2026-10-12T00:00:00.000Z",
			message: "Promoted selected recovery snapshot",
		}];
		return route.fulfill({ json: { result: revisions[0] } });
	});
	await page.goto("/");
	await page.locator('.markdown-editor-host[data-editor-item-id="palette-item-1"]').click();
	await page.getByRole("tab", { name: "履歴" }).click();
	const snapshotsLink = page.getByRole("button", { name: "復元ポイント一覧を開く" });
	await expect(snapshotsLink).toBeEnabled();
	await snapshotsLink.click();
	const snapshots = page.getByRole("region", { name: "復元ポイント" });
	const selector = snapshots.getByLabel("状態");
	await selector.selectOption(snapshot.id);
	await expect.poll(() => previewCalls).toEqual([[snapshot.id, workId, branchId]]);
	await expect(snapshots.getByText("saved recovery content")).toBeVisible();
	const promote = snapshots.getByRole("button", { name: "この状態を稿として保存" });
	await expect(promote).toBeEnabled();
	page.on("dialog", (dialog) => dialog.accept());
	await promote.click();

	await expect.poll(() => promoteCalls).toEqual([[
		snapshot.id,
		workId,
		branchId,
		"confirmed",
	]]);
	await expect(page.getByText("Promoted selected recovery snapshot")).toBeVisible();
});
