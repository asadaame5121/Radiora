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
