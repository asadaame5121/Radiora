import { expect, test } from "@playwright/test";
import type { OutlineItem } from "../../src/domain/models.ts";

function item(index: number): OutlineItem {
	const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
	return {
		id,
		workId: id,
		text: `同時刻 ${index}`,
		parentId: null,
		orderKey: (index + 1) * 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "00000000-0000-4000-8000-000000000001" },
		createdAt: "2026-10-13T00:00:00.000Z",
		updatedAt: "2026-10-13T00:00:00.000Z",
	};
}

test("Tree gestures and selection survive projection, filter, and viewport changes", async ({
	page,
}) => {
	const items = Array.from({ length: 512 }, (_, index) => item(index));
	const filters: unknown[] = [];
	await page.addInitScript(() => Reflect.set(window, "__treeWorldLayoutCalls", 0));
	await page.route("**/src/ui/tree_layout.ts**", async (route) => {
		const response = await route.fetch();
		const source = await response.text();
		await route.fulfill({
			response,
			body:
				`${source}\nconst originalCalculateTreeWorldLayout = calculateTreeWorldLayout;\n` +
				`calculateTreeWorldLayout = (...args) => {\n` +
				`  Reflect.set(globalThis, "__treeWorldLayoutCalls", Number(Reflect.get(globalThis, "__treeWorldLayoutCalls") ?? 0) + 1);\n` +
				`  return originalCalculateTreeWorldLayout(...args);\n` +
				`};\n`,
		});
	});
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.route("**/api/rpc/listGlobalLineage", (route) => {
		const args = Reflect.get(route.request().postDataJSON(), "args");
		const filter = Array.isArray(args) ? args[0] : null;
		filters.push(filter);
		const includeIsolated =
			typeof filter === "object" && filter !== null ? Reflect.get(filter, "includeIsolated") : true;
		const visibleItems = includeIsolated === false ? items.slice(0, 1) : items;
		return route.fulfill({
			json: {
				result: {
					snapshot: { items: visibleItems, links: [], knots: [], stashItemIds: [] },
					promotedBranches: [],
					totalWorkCount: items.length,
					filteredWorkCount: visibleItems.length,
				},
			},
		});
	});

	await page.goto("/");
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	const svg = page.getByRole("group", { name: "思索の系統樹" });
	await expect(svg.locator(".tree-node:not(.aggregate)").first()).toBeVisible();
	const node = svg.locator(".tree-node:not(.aggregate)").first();
	await node.locator(".node-core").click();
	await expect(node).toHaveClass(/selected/);

	const box = await svg.boundingBox();
	if (!box) throw new Error("Tree viewport missing");
	const camera = () =>
		svg.evaluate((element) => {
			const { x, y, k } = Reflect.get(element, "__zoom");
			return { x, y, k };
		});
	const worldLayoutCalls = () =>
		page.evaluate(() => Number(Reflect.get(window, "__treeWorldLayoutCalls") ?? 0));
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	const beforePan = await camera();
	const worldLayoutCallsBeforePan = await worldLayoutCalls();
	const x = box.x + box.width / 2;
	const y = box.y + box.height - 90;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 30, y - 18, { steps: 4 });
	await page.mouse.up();
	await expect.poll(camera).not.toEqual(beforePan);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	expect(await worldLayoutCalls()).toBe(worldLayoutCallsBeforePan);
	const beforeZoom = await camera();
	const worldLayoutCallsBeforeZoom = await worldLayoutCalls();
	await page.mouse.wheel(0, -300);
	await expect.poll(camera).not.toEqual(beforeZoom);
	await expect.poll(worldLayoutCalls).toBeGreaterThan(worldLayoutCallsBeforeZoom);
	await node.focus();
	await expect(node).toBeFocused();

	const beforeProjectionCalls = await worldLayoutCalls();
	await page.getByRole("button", { name: "Lineage", exact: true }).click();
	await expect(page.getByRole("button", { name: "Lineage", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect.poll(worldLayoutCalls).toBeGreaterThan(beforeProjectionCalls);

	const beforeFilter = filters.length;
	const beforeFilterCalls = await worldLayoutCalls();
	await page.getByRole("tab", { name: "フィルター" }).click();
	await page.getByRole("checkbox", { name: /孤立/ }).uncheck();
	await expect.poll(() => filters.length).toBeGreaterThan(beforeFilter);
	await expect.poll(worldLayoutCalls).toBeGreaterThan(beforeFilterCalls);
	await expect(svg).toBeVisible();

	const widthBeforeResize = await svg.evaluate((element) => element.clientWidth);
	const beforeResizeCalls = await worldLayoutCalls();
	await page.setViewportSize({ width: 800, height: 900 });
	await expect
		.poll(() => svg.evaluate((element) => element.clientWidth))
		.not.toBe(widthBeforeResize);
	await expect.poll(worldLayoutCalls).toBeGreaterThan(beforeResizeCalls);
	await expect(svg).toBeVisible();
});

test("zoomed same-time nodes expose keyboard-operable cluster inspection", async ({ page }) => {
	const items = Array.from({ length: 512 }, (_, index) => item(index));
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } }),
	);
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
		}),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	const svg = page.getByRole("group", { name: "思索の系統樹" });
	await expect(svg.locator(".tree-node").first()).toBeVisible();
	await page.getByRole("button", { name: "全体を表示" }).click();
	const cluster = svg.locator(".tree-node.aggregate").first();
	await expect(cluster).toBeVisible();
	await cluster.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("heading", { name: /件の思索/ })).toBeVisible();

	const member = page.locator(".cluster-members .member-main").first();
	await member.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".cluster-members li.selected")).toHaveCount(1);
});
