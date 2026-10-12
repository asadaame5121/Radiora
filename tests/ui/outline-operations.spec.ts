import { expect, test } from "@playwright/test";
import type { OutlineItem } from "../../src/domain/models.ts";

function item(id: string, orderKey: number, text = id): OutlineItem {
	return {
		id,
		workId: id,
		text,
		parentId: null,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${id}-main` },
		createdAt: "2026-10-04T00:00:00Z",
		updatedAt: "2026-10-04T00:00:00Z",
	};
}

function deferred() {
	let release: () => void = () => {
		throw new Error("Gate has not been initialized");
	};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test("reload shows progress while preserving the editor and focus", async ({ page }) => {
	const gate = deferred();
	let reads = 0;
	await page.route("**/api/rpc/listOutline", async (route) => {
		if (++reads > 1) await gate.promise;
		await route.fulfill({
			json: {
				result: {
					items: [item("A", 10)],
					links: [],
					knots: [],
					stashItemIds: [],
				},
			},
		});
	});
	await page.route(
		"**/api/rpc/createItem",
		(route) => route.fulfill({ json: { result: item("new", 20, "") } }),
	);
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "＋ ルートに追加", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "更新中…" })).toBeVisible();
	const editor = page.locator('textarea[data-item-id="A"]');
	await page.locator('.markdown-editor-host[data-editor-item-id="A"]').click();
	await expect(editor).toBeFocused();
	const original = await editor.elementHandle();
	gate.release();
	await expect(page.getByRole("status").filter({ hasText: "更新中…" })).toHaveCount(0);
	await expect(editor).toBeFocused();
	expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
});

test("adding and removing a bookmark reads only bookmarks", async ({ page }) => {
	let outlineReads = 0;
	let treeReads = 0;
	let bookmarkReads = 0;
	let bookmarked = false;
	const bookmark = { id: "bookmark", workId: "A", occurrenceId: "A", createdAt: "now" };
	await page.route("**/api/rpc/listOutline", (route) => {
		outlineReads++;
		return route.fulfill({
			json: {
				result: {
					items: [item("A", 10)],
					links: [],
					knots: [],
					stashItemIds: [],
				},
			},
		});
	});
	await page.route("**/api/rpc/listGlobalLineage", (route) => {
		treeReads++;
		return route.continue();
	});
	await page.route("**/api/rpc/listBookmarks", (route) => {
		bookmarkReads++;
		return route.fulfill({ json: { result: bookmarked ? [bookmark] : [] } });
	});
	await page.route("**/api/rpc/createBookmark", (route) => {
		bookmarked = true;
		return route.fulfill({ json: { result: bookmark } });
	});
	await page.route("**/api/rpc/deleteBookmark", (route) => {
		bookmarked = false;
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.locator('.markdown-editor-host[data-editor-item-id="A"]').click();
	const initial = { outlineReads, treeReads, bookmarkReads };
	await page.getByRole("button", { name: "☆ 栞", exact: true }).click();
	await expect(page.getByRole("button", { name: "栞を削除", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "栞を削除", exact: true }).click();
	await expect(page.getByRole("button", { name: "栞を削除", exact: true })).toHaveCount(
		0,
	);
	expect(bookmarkReads).toBe(initial.bookmarkReads + 2);
	expect(outlineReads).toBe(initial.outlineReads);
	expect(treeReads).toBe(initial.treeReads);
});

for (const departure of ["selection", "screen", "reload-selection"] as const) {
	test(`a persisted Enter does not reclaim selection or focus after ${departure}`, async ({ page }) => {
		const items = [item("A", 10), item("B", 20)];
		const gate = deferred();
		let created = false;
		let waiting = false;
		await page.route("**/api/rpc/listOutline", async (route) => {
			if (created && departure === "reload-selection") {
				waiting = true;
				await gate.promise;
			}
			await route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } });
		});
		await page.route(
			"**/api/rpc/updateItemText",
			(route) => route.fulfill({ json: { result: null } }),
		);
		await page.route("**/api/rpc/createItem", async (route) => {
			const row = item("new", 15, "");
			items.push(row);
			created = true;
			if (departure !== "reload-selection") {
				waiting = true;
				await gate.promise;
			}
			await route.fulfill({ json: { result: row } });
		});
		await page.goto("/", { waitUntil: "domcontentloaded" });
		const editor = page.locator('textarea[data-item-id="A"]');
		await page.locator('.markdown-editor-host[data-editor-item-id="A"]').click();
		await expect(editor).toBeFocused();
		await editor.press("End");
		await editor.press("Enter");
		await expect.poll(() => waiting).toBe(true);
		try {
			if (departure === "screen") {
				await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
				await expect(page.getByRole("button", { name: "アウトラインに戻る", exact: true }))
					.toBeEnabled();
			} else {
				await page.locator('.markdown-editor-host[data-editor-item-id="B"]').click();
				await expect(page.locator('textarea[data-item-id="B"]')).toBeFocused();
			}
		} finally {
			gate.release();
		}
		await expect.poll(() =>
			page.evaluate(() => localStorage.getItem("radiora.pendingEmptyItemIds"))
		)
			.toContain("new");
		if (departure === "screen") {
			await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
			await expect(editor).toBeFocused();
		} else {
			await expect(page.locator('.markdown-editor-host[data-editor-item-id="new"]')).toBeVisible();
			await expect(page.locator('textarea[data-item-id="B"]')).toBeFocused();
			await expect(
				page.getByRole("treeitem").filter({ has: page.locator('textarea[data-item-id="B"]') }),
			)
				.toHaveAttribute("aria-selected", "true");
		}
	});
}

test("empty Backspace removes its pending record and focuses the previous sibling", async ({ page }) => {
	const items = [item("A", 10)];
	await page.addInitScript(() => localStorage.setItem("radiora.pendingEmptyItemIds", "[]"));
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.route("**/api/rpc/deleteItem", (route) => {
		const id: string = route.request().postDataJSON().args[0];
		items.splice(items.findIndex((row) => row.id === id), 1);
		return route.fulfill({ json: { result: null } });
	});
	await page.route(
		"**/api/rpc/updateItemText",
		(route) => route.fulfill({ json: { result: null } }),
	);
	await page.route("**/api/rpc/createItem", (route) => {
		const row = item("empty", 20, "");
		items.push(row);
		return route.fulfill({ json: { result: row } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.locator('.markdown-editor-host[data-editor-item-id="A"]').click();
	await page.locator('textarea[data-item-id="A"]').press("End");
	await page.locator('textarea[data-item-id="A"]').press("Enter");
	const editor = page.locator('textarea[data-item-id="empty"]');
	await expect(editor).toBeFocused();
	await expect.poll(() => page.evaluate(() => localStorage.getItem("radiora.pendingEmptyItemIds")))
		.toContain("empty");
	await editor.press("Backspace");
	await expect(editor).toHaveCount(0);
	await expect(page.locator('textarea[data-item-id="A"]')).toBeFocused();
	await expect.poll(() => page.evaluate(() => localStorage.getItem("radiora.pendingEmptyItemIds")))
		.toBe("[]");
});

test("collapsing a row does not reload the Outline or unrelated views", async ({ page }) => {
	const items = [item("A", 10), { ...item("child", 20), parentId: "A" }, item("B", 30)];
	const reads = { outline: 0, tree: 0, bookmarks: 0 };
	await page.route("**/api/rpc/listOutline", (route) => {
		reads.outline++;
		return route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } });
	});
	await page.route("**/api/rpc/listGlobalLineage", (route) => {
		reads.tree++;
		return route.continue();
	});
	await page.route("**/api/rpc/listBookmarks", (route) => {
		reads.bookmarks++;
		return route.continue();
	});
	await page.route("**/api/rpc/setCollapsed", (route) => {
		const [id, collapsed]: [string, boolean] = route.request().postDataJSON().args;
		const target = items.find((row) => row.id === id);
		if (!target) throw new Error(`Unknown item: ${id}`);
		target.collapsed = collapsed;
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const disclosure = page.getByRole("button", { name: "Aを折りたたむ", exact: true });
	await expect(disclosure).toBeVisible();
	const unrelatedEditor = await page.locator('textarea[data-item-id="B"]').elementHandle();
	const unrelatedUpdates = await page.locator(".row").filter({
		has: page.locator('textarea[data-item-id="B"]'),
	}).evaluateHandle((row) => {
		const records: MutationRecord[] = [];
		const observer = new MutationObserver((changes) => {
			// OverType dismisses link tooltips on every document click, independently of row updates.
			records.push(
				...changes.filter((change) =>
					!(change.target instanceof Element && change.target.closest(".overtype-link-tooltip"))
				),
			);
		});
		observer.observe(row, {
			attributes: true,
			characterData: true,
			childList: true,
			subtree: true,
		});
		return { observer, records };
	});
	const initialReads = { ...reads };
	await disclosure.click();
	await expect(page.locator('textarea[data-item-id="child"]')).toHaveCount(0);
	expect(reads).toEqual(initialReads);
	expect(await unrelatedEditor?.evaluate((element) => element.isConnected)).toBe(true);
	await page.getByRole("button", { name: "Aを展開", exact: true }).click();
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="child"]')).toBeVisible();
	expect(reads).toEqual(initialReads);
	expect(await unrelatedUpdates.evaluate(({ records }) => records.length)).toBe(0);
	await unrelatedUpdates.evaluate(({ observer }) => observer.disconnect());
	await unrelatedUpdates.dispose();
});

test("collapse saved during Outline return preparation does not cancel the newer navigation", async ({ page }) => {
	const items = [item("A", 10), { ...item("child", 20), parentId: "A" }];
	const write = deferred();
	const navigationRead = deferred();
	let writeStarted = false;
	let holdNextRead = false;
	let readWaiting = false;
	let reads = 0;
	await page.route("**/api/rpc/listOutline", async (route) => {
		reads++;
		const captured = items.map((row) => ({ ...row }));
		if (holdNextRead) {
			holdNextRead = false;
			readWaiting = true;
			await navigationRead.promise;
		}
		await route.fulfill({
			json: { result: { items: captured, links: [], knots: [], stashItemIds: [] } },
		});
	});
	await page.route("**/api/rpc/setCollapsed", async (route) => {
		writeStarted = true;
		await write.promise;
		items[0].collapsed = true;
		await route.fulfill({ json: { result: null } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.locator('.markdown-editor-host[data-editor-item-id="A"]').click();
	await expect(page.locator('textarea[data-item-id="A"]')).toBeFocused();
	await page.getByRole("button", { name: "Aを折りたたむ", exact: true }).click();
	await expect.poll(() => writeStarted).toBe(true);
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	const back = page.getByRole("button", { name: "アウトラインに戻る", exact: true });
	await expect(back).toBeEnabled();
	const initialReads = reads;
	holdNextRead = true;
	await back.click();
	await expect.poll(() => readWaiting).toBe(true);
	try {
		const response = page.waitForResponse("**/api/rpc/setCollapsed");
		write.release();
		await response;
		await page.evaluate(() =>
			new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
		);
	} finally {
		navigationRead.release();
	}
	await expect(page.locator(".outline-context h1")).toHaveText("ルート");
	await expect(page.getByRole("button", { name: "Aを展開", exact: true })).toBeVisible();
	await expect(page.locator('textarea[data-item-id="child"]')).toHaveCount(0);
});

test("a failed disclosure click reports its cause without an unhandled rejection or reload", async ({ page }) => {
	const items = [item("A", 10), { ...item("child", 20), parentId: "A" }];
	let reads = 0;
	const pageErrors: string[] = [];
	page.on("pageerror", (cause) => pageErrors.push(cause.message));
	await page.route("**/api/rpc/listOutline", (route) => {
		reads++;
		return route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } });
	});
	await page.route(
		"**/api/rpc/setCollapsed",
		(route) => route.fulfill({ status: 500, json: { message: "collapse failed" } }),
	);
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const disclosure = page.getByRole("button", { name: "Aを折りたたむ", exact: true });
	await expect(disclosure).toBeVisible();
	const initialReads = reads;
	await disclosure.click();
	await expect(page.locator(".error")).toContainText("collapse failed");
	await expect(disclosure).toBeVisible();
	expect(pageErrors).toEqual([]);
	expect(reads).toBe(initialReads);
});
