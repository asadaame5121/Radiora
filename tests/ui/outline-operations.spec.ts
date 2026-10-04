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
