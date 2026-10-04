import { expect, test } from "@playwright/test";

async function openTree(page: import("@playwright/test").Page) {
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	const svg = page.getByRole("group", { name: "思索の系統樹" });
	await expect(svg).toBeVisible();
	await expect(svg.locator(".tree-node").first()).toBeVisible();
	return svg;
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
});

test("native mouse pan, wheel zoom and background selection retain SVG-local coordinates", async ({ page }) => {
	const svg = await openTree(page);
	const node = svg.locator(".tree-node:not(.aggregate)").first();
	await node.locator(".node-core").click();
	await expect(node).toHaveClass(/selected/);
	const box = await svg.boundingBox();
	if (!box) throw new Error("Tree viewport missing");
	const x = box.x + box.width / 2;
	const y = box.y + box.height - 90;
	const transform = await node.getAttribute("transform");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 35, y - 20, { steps: 4 });
	await page.mouse.up();
	await expect(node).not.toHaveAttribute("transform", transform ?? "");
	await expect(node).toHaveClass(/selected/);
	const camera = await svg.evaluate((element) => Reflect.get(element, "__zoom").k);
	await page.mouse.move(x, y);
	await page.mouse.wheel(0, -150);
	await expect.poll(() => svg.evaluate((element) => Reflect.get(element, "__zoom").k))
		.toBeGreaterThan(camera);
	await page.mouse.click(x, y);
	await expect(svg.locator(".tree-node.selected")).toHaveCount(0);
	await expect(svg).toBeFocused();
});

test("unmount during captured pan releases window gesture handlers and permits a fresh pan", async ({ page }) => {
	const svg = await openTree(page);
	const box = await svg.boundingBox();
	if (!box) throw new Error("Tree viewport missing");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height - 90);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height - 100);
	const oldSvg = await svg.elementHandle();
	if (!oldSvg) throw new Error("Tree SVG missing");
	const camera = await oldSvg.evaluate((element) => {
		const { x, y, k } = Reflect.get(element, "__zoom");
		return { x, y, k };
	});
	await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "Option",
		exact: true,
	}).dispatchEvent("click");
	await expect(svg).toHaveCount(0);
	await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height - 120);
	await page.mouse.up();
	expect(
		await oldSvg.evaluate((element) => {
			const { x, y, k } = Reflect.get(element, "__zoom");
			return { x, y, k };
		}),
	).toEqual(camera);
	const remounted = await openTree(page);
	const node = remounted.locator(".tree-node").first();
	const before = await node.getAttribute("transform");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height - 90);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height - 110);
	await page.mouse.up();
	await expect(node).not.toHaveAttribute("transform", before ?? "");
});

test("Tree and Options share projection with one writer through remount and restart", async ({ page }) => {
	await page.addInitScript(() => {
		const writes: string[] = [];
		Reflect.set(window, "treePreferenceWrites", writes);
		const set = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (key === "radiora.treeProjection") writes.push(value);
			return set.call(this, key, value);
		};
	});
	await page.reload();
	await openTree(page);
	await page.getByRole("button", { name: "Lineage", exact: true }).click();
	await expect(page.getByRole("button", { name: "Lineage", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect.poll(() => page.evaluate(() => Reflect.get(window, "treePreferenceWrites"))).toEqual(
		["lineage"],
	);
	await page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "Option",
		exact: true,
	}).click();
	const preference = page.getByLabel("ツリーの表示方式");
	await expect(preference).toHaveValue("lineage");
	await preference.selectOption("chronology");
	await openTree(page);
	await expect(page.getByRole("button", { name: "Chronology", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await page.getByRole("button", { name: "Lineage", exact: true }).click();
	await page.reload();
	await openTree(page);
	await expect(page.getByRole("button", { name: "Lineage", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

test("initial Tree failure exposes retry and successful retry clears the error", async ({ page }) => {
	await page.route(
		"**/api/rpc/listGlobalLineage",
		(route) => route.fulfill({ status: 503, json: { error: "Tree offline" } }),
	);
	await page.reload();
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	await expect(page.getByRole("alert").filter({ hasText: "ツリーを読み込めませんでした" }))
		.toBeVisible();
	await expect(page.getByRole("status").filter({ hasText: "ツリーを読み込んでいます" }))
		.toHaveCount(0);
	await page.unroute("**/api/rpc/listGlobalLineage");
	await page.getByRole("button", { name: "ツリーを再試行" }).click();
	await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeVisible();
	await expect(page.getByRole("alert").filter({ hasText: "ツリーを読み込めませんでした" }))
		.toHaveCount(0);
});

test("failed filter refresh retains the Tree and permits retry", async ({ page }) => {
	const svg = await openTree(page);
	await page.route(
		"**/api/rpc/listGlobalLineage",
		(route) => route.fulfill({ status: 503, json: { error: "Tree offline" } }),
	);
	await page.getByRole("tab", { name: "フィルター" }).click();
	await page.getByRole("checkbox", { name: /孤立/ }).uncheck();
	await expect(page.getByRole("alert").filter({ hasText: "ツリーを読み込めませんでした" }))
		.toBeVisible();
	await expect(svg).toBeVisible();
	await expect(svg.locator(".tree-node").first()).toBeVisible();
	await page.unroute("**/api/rpc/listGlobalLineage");
	await page.getByRole("button", { name: "ツリーを再試行" }).click();
	await expect(page.getByRole("alert").filter({ hasText: "ツリーを読み込めませんでした" }))
		.toHaveCount(0);
	await expect(svg).toBeVisible();
});
