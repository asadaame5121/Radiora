import { expect, type Page, test } from "@playwright/test";

function outlineRow(page: Page, id: string) {
	return page.locator(`[data-outline-row-id="${id}"]`);
}

function item(index: number) {
	const id = `blank-click-${index}`;
	return {
		id,
		workId: id,
		text: id,
		parentId: null,
		orderKey: (index + 1) * 1024,
		collapsed: false,
		revisionSelector: { mode: "branch" as const, branchId: `${id}-main` },
		createdAt: "2026-10-13T00:00:00.000Z",
		updatedAt: "2026-10-13T00:00:00.000Z",
	};
}

async function openOutline(page: Page, count = 3) {
	const items = Array.from({ length: count }, (_, index) => item(index));
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(outlineRow(page, "blank-click-0")).toBeVisible();
}

async function selectAndFocusEditor(page: Page, id: string) {
	const row = outlineRow(page, id);
	const editor = row.locator("textarea");
	await row.locator(".markdown-editor-host").click();
	await expect(row).toHaveAttribute("aria-selected", "true");
	await expect(editor).toBeFocused();
	return { row, editor };
}

test("native click on a row's blank surface deselects and releases editor focus", async ({ page }) => {
	await openOutline(page);
	const { row, editor } = await selectAndFocusEditor(page, "blank-click-0");
	const box = await row.boundingBox();
	if (!box) throw new Error("Outline row has no visible bounding box");
	const x = box.x + box.width - 2;
	const y = box.y + box.height / 2;
	const hitIsRow = await page.evaluate(
		({ x, y, id }) =>
			document.elementFromPoint(x, y) === document.querySelector(
				`[data-outline-row-id="${id}"]`,
			),
		{ x, y, id: "blank-click-0" },
	);
	expect(hitIsRow).toBe(true);
	await page.mouse.click(x, y);
	await expect(row).toHaveAttribute("aria-selected", "false");
	await expect(editor).not.toBeFocused();
});

test("native click on blank space in the rows container deselects and releases editor focus", async ({ page }) => {
	await openOutline(page);
	const { row, editor } = await selectAndFocusEditor(page, "blank-click-0");
	const rows = page.locator(".rows[role=tree]");
	await rows.evaluate((element) => {
		element.style.minHeight = "600px";
	});
	const box = await rows.boundingBox();
	if (!box) throw new Error("Outline rows container has no visible bounding box");
	const x = box.x + box.width / 2;
	const y = box.y + box.height - 4;
	const hitIsRows = await rows.evaluate(
		(element, point) => document.elementFromPoint(point.x, point.y) === element,
		{ x, y },
	);
	expect(hitIsRows).toBe(true);
	await page.mouse.click(x, y);
	await expect(row).toHaveAttribute("aria-selected", "false");
	await expect(editor).not.toBeFocused();
});

test("native click on the editor does not deselect its row", async ({ page }) => {
	await openOutline(page);
	const { row, editor } = await selectAndFocusEditor(page, "blank-click-0");
	const box = await row.locator(".markdown-editor-host").boundingBox();
	if (!box) throw new Error("Outline editor has no visible bounding box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(row).toHaveAttribute("aria-selected", "true");
	await expect(editor).toBeFocused();
});
