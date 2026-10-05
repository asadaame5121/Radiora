import { expect, test } from "@playwright/test";
import type { OutlineItem, OutlineSnapshot } from "../../src/domain/models.ts";

function outline(text: string): OutlineSnapshot {
	const item: OutlineItem = {
		id: "startup-item",
		workId: "startup-work",
		text,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "startup-branch" },
		createdAt: "2026-10-04T00:00:00Z",
		updatedAt: "2026-10-04T00:00:00Z",
	};
	return { items: [item], links: [], knots: [], stashItemIds: [] };
}

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test("reload caches saved API text while an unsaved draft stays visible", async ({ page }) => {
	let cached: OutlineSnapshot | null = null;
	const cachedItem = () => cached?.items[0];
	let collapsed = false;
	let writes = 0;
	await page.route("**/api/rpc/listOutline", (route) => {
		const snapshot = outline(collapsed ? "new saved text" : "saved text");
		snapshot.items[0].collapsed = collapsed;
		snapshot.items.push({
			...snapshot.items[0],
			id: "child",
			workId: "child-work",
			parentId: "startup-item",
			text: "child",
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "child-branch" },
		});
		return route.fulfill({ json: { result: snapshot } });
	});
	await page.route("**/api/rpc/saveStartupSnapshotCache", (route) => {
		cached = route.request().postDataJSON().args[0];
		writes++;
		return route.fulfill({ json: { result: null } });
	});
	await page.route(
		"**/api/rpc/updateItemText",
		(route) => route.fulfill({ status: 500, json: { message: "save offline" } }),
	);
	await page.route("**/api/rpc/setCollapsed", (route) => {
		collapsed = true;
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect.poll(() => cached?.items[0].text).toBe("saved text");
	await page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]').click();
	const editor = page.locator('textarea[data-item-id="startup-item"]');
	await editor.fill("unsaved draft");
	await expect(page.locator(".working-copy-save-status.failed")).toBeVisible();
	await page.getByRole("button", { name: /を折りたたむ$/ }).click();
	await expect.poll(() => cached?.items[0].text).toBe("new saved text");
	await expect(editor).toHaveValue("unsaved draft");
	expect(cachedItem()?.collapsed).toBe(true);
	const savedWrites = writes;
	await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
	await expect(editor).toHaveValue("unsaved draft");
	expect(writes).toBe(savedWrites);
});

test("accepted cache remains inert through a core load failure and retry", async ({ page }) => {
	let ready = false;
	let retry = false;
	await page.route("**/api/rpc/loadStartupSnapshotCache", (route) =>
		route.fulfill({
			json: {
				result: {
					version: 1,
					savedAt: "now",
					snapshot: outline("cached"),
					location: { selectedOccurrenceId: "startup-item", hoistOccurrenceId: "startup-item" },
				},
			},
		}));
	await page.route("**/api/rpc/getStartupStatus", (route) =>
		route.fulfill({
			json: {
				result: { phase: ready ? "ready" : "starting" },
			},
		}));
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: retry ? { result: outline("fresh") } : { error: "outline offline" } }),
	);
	await page.route("**/api/rpc/retryStartup", (route) => {
		retry = true;
		return route.fulfill({ json: { result: { phase: "ready" } } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".shell")).toHaveAttribute("inert", "");
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]'))
		.toContainText("cached");
	ready = true;
	await expect(page.locator(".startup-cache-status")).toContainText("起動に失敗しました");
	await page.getByRole("button", { name: "再試行", exact: true }).click();
	await expect(page.locator(".shell")).not.toHaveAttribute("inert", "");
	await expect(page.locator(".startup-cache-status")).toHaveCount(0);
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]'))
		.toContainText("fresh");
});

test("a cache reload revokes the delayed initial Outline response", async ({ page }) => {
	const initial = gate();
	const oldResponse = gate();
	let reads = 0;
	await page.route("**/api/rpc/loadStartupSnapshotCache", (route) =>
		route.fulfill({
			json: {
				result: {
					version: 1,
					savedAt: "now",
					snapshot: outline("cached"),
					location: { selectedOccurrenceId: "startup-item", hoistOccurrenceId: null },
				},
			},
		}));
	// Let cache restoration finish before the formal startup load.
	const readiness = gate();
	await page.route("**/api/rpc/getStartupStatus", async (route) => {
		await readiness.promise;
		await route.fulfill({ json: { result: { phase: "ready" } } });
	});
	await page.route("**/api/rpc/listOutline", async (route) => {
		const first = ++reads === 1;
		if (first) await initial.promise;
		await route.fulfill({ json: { result: outline(first ? "stale" : "fresh") } });
		if (first) oldResponse.release();
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".shell")).toHaveAttribute("inert", "");
	readiness.release();
	await expect.poll(() => reads).toBe(1);
	await page.getByRole("button", { name: "再読み込み", exact: true }).click();
	await expect(page.locator(".shell")).not.toHaveAttribute("inert", "");
	const editor = page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]');
	await expect(editor).toContainText("fresh");
	initial.release();
	await oldResponse.promise;
	await expect(editor).toContainText("fresh");
	await expect(page.locator(".startup-cache-status")).toHaveCount(0);
});

test("without a cache, a core load failure exposes a working retry", async ({ page }) => {
	let retry = false;
	await page.route(
		"**/api/rpc/loadStartupSnapshotCache",
		(route) => route.fulfill({ json: { result: null } }),
	);
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({
				json: retry ? { result: outline("recovered") } : { error: "outline offline" },
			}),
	);
	await page.route("**/api/rpc/retryStartup", (route) => {
		retry = true;
		return route.fulfill({ json: { result: { phase: "ready" } } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(page.getByRole("heading", { name: "初期データの読み込みに失敗しました。" }))
		.toBeVisible();
	await page.getByRole("button", { name: "再試行", exact: true }).click();
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]'))
		.toContainText("recovered");
	await expect(page.locator(".startup-card")).toHaveCount(0);
});

test("autosaved inline text survives cache startup when the next formal load fails", async ({ page }) => {
	let cached: OutlineSnapshot | null = null;
	const cachedText = () => cached?.items[0].text;
	let restarting = false;
	let reads = 0;
	let saving = false;
	const save = gate();
	await page.route(
		"**/api/rpc/loadStartupSnapshotCache",
		(route) =>
			route.fulfill({
				json: {
					result: cached
						? {
							version: 1,
							savedAt: "now",
							snapshot: cached,
							location: { selectedOccurrenceId: "startup-item", hoistOccurrenceId: null },
						}
						: null,
				},
			}),
	);
	await page.route("**/api/rpc/listOutline", (route) => {
		reads++;
		return route.fulfill({
			json: restarting ? { error: "outline offline" } : { result: outline("before edit") },
		});
	});
	await page.route("**/api/rpc/saveStartupSnapshotCache", (route) => {
		cached = route.request().postDataJSON().args[0];
		return route.fulfill({ json: { result: null } });
	});
	await page.route("**/api/rpc/updateItemText", async (route) => {
		saving = true;
		await save.promise;
		await route.fulfill({ json: { result: null } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect.poll(cachedText).toBe("before edit");
	await page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]').click();
	await page.locator('textarea[data-item-id="startup-item"]').fill("autosaved text");
	await expect.poll(() => saving).toBe(true);
	// Pending input must not become the persisted startup cache.
	expect(cachedText()).toBe("before edit");
	save.release();
	await expect.poll(cachedText).toBe("autosaved text");
	expect(reads).toBe(1);
	restarting = true;
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator(".startup-cache-status")).toContainText(
		"前回の内容を表示しています。起動に失敗しました。",
	);
	await expect(page.locator('.markdown-editor-host[data-editor-item-id="startup-item"]'))
		.toContainText("autosaved text");
});
