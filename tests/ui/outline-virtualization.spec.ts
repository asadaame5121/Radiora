import { expect, type Page, test } from "@playwright/test";
import type { OutlineItem } from "../../src/domain/models.ts";
import { DEFAULT_OUTLINE_OVERSCAN } from "../../src/ui/virtual_outline_viewport.ts";

function item(index: number, text = `行 ${index}`): OutlineItem {
	const id = `outline-${index}`;
	return {
		id,
		workId: id,
		text,
		parentId: null,
		orderKey: (index + 1) * 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${id}-main` },
		createdAt: "2026-10-13T00:00:00.000Z",
		updatedAt: "2026-10-13T00:00:00.000Z",
	};
}

async function openLargeOutline(page: Page, largeTextIndex?: number): Promise<void> {
	const items = Array.from({ length: 10_000 }, (_, index) =>
		item(index, index === largeTextIndex ? "x".repeat(2_048) : undefined),
	);
	await page.route("**/api/rpc/listOutline", (route) =>
		route.fulfill({ json: { result: { items, links: [], knots: [], stashItemIds: [] } } }),
	);
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".rows[role=tree]")).toBeVisible();
	await expect(page.locator('[data-outline-row-id="outline-0"]')).toBeAttached();
}

async function scrollOwnerToOffset(page: Page, scrollTop: number): Promise<void> {
	await page.locator(".rows").evaluate((rows, top) => {
		let owner = rows.parentElement;
		while (owner) {
			const overflowY = getComputedStyle(owner).overflowY;
			if (overflowY === "auto" || overflowY === "scroll") break;
			owner = owner.parentElement;
		}
		if (owner) owner.scrollTop = top;
		else window.scrollTo(0, top);
	}, scrollTop);
}

async function mountedLimit(page: Page): Promise<number> {
	const { visible, protectedCount } = await page.locator(".rows").evaluate((root) => {
		let owner: HTMLElement | null = null;
		for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
			if (["auto", "scroll"].includes(getComputedStyle(ancestor).overflowY)) {
				owner = ancestor;
				break;
			}
		}
		const viewportTop = owner?.getBoundingClientRect().top ?? 0;
		const viewportBottom = viewportTop + (owner?.clientHeight ?? innerHeight);
		const rows = [...root.querySelectorAll<HTMLElement>("[role=treeitem]")];
		const activeId =
			document.activeElement instanceof HTMLTextAreaElement
				? document.activeElement.dataset.itemId
				: undefined;
		const counts = rows.reduce(
			(counts, row) => {
				const rect = row.getBoundingClientRect();
				if (rect.bottom > viewportTop && rect.top < viewportBottom) counts.visible += 1;
				const id = row.dataset.outlineRowId;
				if (
					id &&
					(row.getAttribute("aria-selected") === "true" ||
						row.classList.contains("dragging") ||
						id === activeId)
				)
					counts.protectedIds.add(id);
				return counts;
			},
			{ visible: 0, protectedIds: new Set<string>() },
		);
		return { visible: counts.visible, protectedCount: counts.protectedIds.size };
	});
	return visible + DEFAULT_OUTLINE_OVERSCAN * 2 + protectedCount + 2;
}

async function scrollOwnerToBottom(page: Page): Promise<void> {
	await page.locator(".rows").evaluate((rows) => {
		let owner = rows.parentElement;
		while (owner) {
			const overflowY = getComputedStyle(owner).overflowY;
			if (overflowY === "auto" || overflowY === "scroll") break;
			owner = owner.parentElement;
		}
		if (owner) owner.scrollTop = owner.scrollHeight;
		else window.scrollTo(0, document.documentElement.scrollHeight);
	});
}

async function scrollOwnerToTop(page: Page): Promise<void> {
	await page.locator(".rows").evaluate((rows) => {
		let owner = rows.parentElement;
		while (owner) {
			const overflowY = getComputedStyle(owner).overflowY;
			if (overflowY === "auto" || overflowY === "scroll") break;
			owner = owner.parentElement;
		}
		if (owner) owner.scrollTop = 0;
		else window.scrollTo(0, 0);
	});
}

for (const width of [1440, 800]) {
	test(`virtualizes 10,000 rows at ${width}px and reaches the last row`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await openLargeOutline(page);
		const visible = await page.locator(".rows").evaluate((root) => {
			let owner = root.parentElement;
			while (owner) {
				const overflowY = getComputedStyle(owner).overflowY;
				if (overflowY === "auto" || overflowY === "scroll") break;
				owner = owner.parentElement;
			}
			const viewportTop = owner?.getBoundingClientRect().top ?? 0;
			const viewportBottom = viewportTop + (owner?.clientHeight ?? innerHeight);
			const rows = [...root.querySelectorAll<HTMLElement>("[role=treeitem]")];
			let count = 0;
			for (const row of rows) {
				const rect = row.getBoundingClientRect();
				if (rect.bottom > viewportTop && rect.top < viewportBottom) count++;
			}
			return count;
		});
		const protectedCount = await page.locator(".rows").evaluate((root) => {
			const protectedIds = new Set<string>();
			for (const row of root.querySelectorAll<HTMLElement>("[role=treeitem]")) {
				if (row.getAttribute("aria-selected") === "true" || row.classList.contains("dragging")) {
					const id = row.dataset.outlineRowId;
					if (id) protectedIds.add(id);
				}
			}
			const activeId =
				document.activeElement instanceof HTMLTextAreaElement
					? document.activeElement.dataset.itemId
					: undefined;
			if (activeId) protectedIds.add(activeId);
			return protectedIds.size;
		});
		const mountedCount = await page.locator(".rows [role=treeitem]").count();
		expect(mountedCount).toBeLessThanOrEqual(
			visible + DEFAULT_OUTLINE_OVERSCAN * 2 + protectedCount + 2,
		);
		await scrollOwnerToOffset(page, 5_000 * 44);
		await expect(page.locator('[data-outline-row-id="outline-5000"]')).toBeVisible();
		expect(await page.locator(".rows [role=treeitem]").count()).toBeLessThanOrEqual(
			await mountedLimit(page),
		);
		await scrollOwnerToBottom(page);
		await expect(page.locator('[data-outline-row-id="outline-9999"]')).toBeVisible();
		await expect
			.poll(() =>
				page.locator('[data-outline-row-id="outline-9999"]').evaluate((row) => {
					let owner = row.parentElement;
					while (owner && !["auto", "scroll"].includes(getComputedStyle(owner).overflowY)) {
						owner = owner.parentElement;
					}
					if (!owner) return false;
					const rect = row.getBoundingClientRect();
					const top = owner.getBoundingClientRect().top + owner.clientTop;
					return (
						rect.top >= top - 1 &&
						rect.bottom <= top + owner.clientHeight + 1 &&
						owner.scrollTop > 0
					);
				}),
			)
			.toBe(true);
		if (width === 800) {
			expect(await page.locator(".app-main").evaluate((owner) => owner.scrollTop)).toBeGreaterThan(
				0,
			);
			expect(await page.locator(".outline-panel").evaluate((panel) => panel.scrollTop)).toBe(0);
		}
	});
}

test("keeps the middle scroll anchor stable when a mounted row above it grows", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openLargeOutline(page);
	await scrollOwnerToOffset(page, 500 * 44 + 5);

	const anchor = page.locator('[data-outline-row-id="outline-500"]');
	const changing = page.locator('[data-outline-row-id="outline-498"]');
	await expect(anchor).toBeVisible();
	await expect(changing).toBeAttached();
	const anchorTop = await anchor.evaluate((row) => row.getBoundingClientRect().top);
	const previousHeight = await changing.evaluate((row) => row.getBoundingClientRect().height);

	await changing.locator("button.bullet").dispatchEvent("click");
	await expect(changing).toHaveClass(/selected/);
	await expect
		.poll(() => changing.evaluate((row) => row.getBoundingClientRect().height))
		.toBeGreaterThan(previousHeight);
	const nextAnchorTop = await anchor.evaluate((row) => row.getBoundingClientRect().top);
	expect(Math.abs(nextAnchorTop - anchorTop)).toBeLessThanOrEqual(1);
});

test("mounts a 2 KB editor at a middle index without expanding the rendered window", async ({
	page,
}) => {
	await openLargeOutline(page, 2_048);
	await scrollOwnerToOffset(page, 2_048 * 44);
	const editor = page.locator('textarea[data-item-id="outline-2048"]');
	await expect(editor).toHaveValue("x".repeat(2_048));
	await page
		.locator('[data-outline-row-id="outline-2048"] .markdown-editor-host')
		.dispatchEvent("click");
	await expect(editor).toBeFocused();
	const original = await editor.elementHandle();
	await scrollOwnerToBottom(page);
	expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
	await expect(editor).toBeFocused();
	const box = await editor.boundingBox();
	expect(box?.y).toBeLessThan(0);
	expect(await page.locator(".rows [role=treeitem]").count()).toBeLessThanOrEqual(
		await mountedLimit(page),
	);
});

test("focused composing and dragged rows survive window changes, then release", async ({
	page,
}) => {
	await openLargeOutline(page);
	const composing = page.locator('textarea[data-item-id="outline-0"]');
	const original = await composing.elementHandle();
	await composing.focus();
	await composing.dispatchEvent("compositionstart");
	await page.locator('textarea[data-item-id="outline-1"]').focus();
	await scrollOwnerToBottom(page);
	expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
	await composing.dispatchEvent("compositionend");
	await expect(page.locator('[data-outline-row-id="outline-0"]')).toHaveCount(0);

	await scrollOwnerToTop(page);
	const dragged = page.locator('[data-outline-row-id="outline-2"]');
	const draggedHandle = await dragged.elementHandle();
	await dragged.dispatchEvent("dragstart");
	await scrollOwnerToBottom(page);
	expect(await draggedHandle?.evaluate((element) => element.isConnected)).toBe(true);
	await dragged.dispatchEvent("dragend");
	await expect(page.locator('[data-outline-row-id="outline-2"]')).toHaveCount(0);
});

test("dropping on a virtual gap resolves a logical target outside the DOM", async ({ page }) => {
	await openLargeOutline(page);
	let moveInput = { id: "", parentId: null as string | null, afterId: null as string | null };
	await page.route("**/api/rpc/moveItem", async (route) => {
		const rawInput = route.request().postDataJSON().args[0];
		if (typeof rawInput !== "object" || rawInput === null) {
			throw new Error("moveItem did not receive an object.");
		}
		const id = Reflect.get(rawInput, "id");
		const parentId = Reflect.get(rawInput, "parentId");
		const afterId = Reflect.get(rawInput, "afterId");
		if (
			typeof id !== "string" ||
			(parentId !== null && typeof parentId !== "string") ||
			(afterId !== null && typeof afterId !== "string")
		) {
			throw new Error("moveItem received malformed arguments.");
		}
		moveInput = { id, parentId, afterId };
		await route.fulfill({ json: { result: null } });
	});
	const source = page.locator('[data-outline-row-id="outline-0"]');
	await source.dispatchEvent("dragstart");
	const gap = page.locator(".virtual-gap").last();
	await expect(gap).toBeAttached();
	await gap.evaluate((element) => {
		element.dispatchEvent(
			new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				clientY: 100_000,
				dataTransfer: new DataTransfer(),
			}),
		);
	});
	await expect.poll(() => moveInput.id).toBe("outline-0");
	expect(moveInput.parentId).toBeNull();
	expect(moveInput.afterId).toMatch(/^outline-\d+$/);
	await expect(page.locator(`[data-outline-row-id="${moveInput.afterId}"]`)).toHaveCount(0);
});
