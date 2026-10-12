import { expect, test } from "@playwright/test";
import type { OutlineItem, OutlineLink } from "../../src/domain/models.ts";

function item(id: string, orderKey: number): OutlineItem {
	return {
		id,
		workId: id,
		text: `${id} title\nbody`,
		parentId: null,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${id}-main` },
		createdAt: "2026-10-12T00:00:00Z",
		updatedAt: "2026-10-12T00:00:00Z",
	};
}

function link(id: string, from: string, to: string): OutlineLink {
	return {
		id,
		fromId: from,
		toId: to,
		from: { scope: "work", workId: from },
		to: { scope: "work", workId: to },
		type: "SUPPORT",
		status: "asserted",
		origin: "human",
		createdAt: "2026-10-12T00:00:00Z",
		reason: "explained",
	};
}

test("body typing skips annotation projection; title typing changes only dependent row content", async ({ page }) => {
	const items = ["A", "B", "C", "D"].map(item);
	const links = [link("ab", "A", "B"), link("cd", "C", "D")];
	// Count real client-side projection calls without introducing production instrumentation.
	await page.addInitScript(() => {
		document.addEventListener("annotation-projection", () => {
			const root = document.documentElement;
			root.dataset.annotationProjectionCount = String(
				Number(root.dataset.annotationProjectionCount ?? "0") + 1,
			);
		});
	});
	await page.route("**/src/services/semantic_link_annotations.ts", async (route) => {
		const response = await route.fetch();
		const source = await response.text();
		const instrumented = source.replace(
			/(function projectSemanticLinkAnnotations\([\s\S]*?\)\s*\{)/u,
			'$1\n document.dispatchEvent(new Event("annotation-projection"));',
		);
		expect(instrumented).not.toBe(source);
		await route.fulfill({ response, body: instrumented });
	});
	await page.route(
		"**/api/rpc/listOutline",
		(route) => route.fulfill({ json: { result: { items, links, knots: [], stashItemIds: [] } } }),
	);
	await page.route("**/api/rpc/updateItemText", (route) => {
		const [id, text]: [string, string] = route.request().postDataJSON().args;
		const target = items.find((entry) => entry.id === id);
		if (!target) throw new Error(`Unknown item: ${id}`);
		target.text = text;
		return route.fulfill({ json: { result: null } });
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const row = (id: string) =>
		page.locator(".row").filter({
			has: page.locator(`textarea[data-item-id="${id}"]`),
		});
	await expect(row("B").locator(".semantic-link-annotations")).toContainText("A title");
	await page.locator('.markdown-editor-host[data-editor-item-id="A"]').click();
	const editor = page.locator('textarea[data-item-id="A"]');
	await expect(editor).toBeFocused();
	const originalEditor = await editor.elementHandle();
	const unrelatedUpdates = await row("C").evaluateHandle((element) => {
		const records: MutationRecord[] = [];
		const observer = new MutationObserver((changes) => {
			// OverType's document-click tooltip dismissal is independent of annotation publication.
			records.push(
				...changes.filter((change) =>
					!(change.target instanceof Element && change.target.closest(".overtype-link-tooltip"))
				),
			);
		});
		observer.observe(element, {
			attributes: true,
			characterData: true,
			childList: true,
			subtree: true,
		});
		return { records, observer };
	});
	const projectionCount = () =>
		page.evaluate(() => Number(document.documentElement.dataset.annotationProjectionCount ?? "0"));
	const initialCount = await projectionCount();
	expect(initialCount).toBeGreaterThan(0);
	try {
		const bodySaved = page.waitForRequest("**/api/rpc/updateItemText");
		await editor.fill("A title\nchanged body");
		await bodySaved;
		expect(await projectionCount()).toBe(initialCount);
		await expect(row("B").locator(".semantic-link-annotations")).toContainText("A title");
		await editor.fill("Renamed A\nchanged body");
		await expect(row("B").locator(".semantic-link-annotations")).toContainText("Renamed A");
		expect(await projectionCount()).toBe(initialCount + 1);
		expect(await unrelatedUpdates.evaluate(({ records }) => records.length)).toBe(0);
		expect(await originalEditor?.evaluate((element) => element.isConnected)).toBe(true);
		await expect(editor).toBeFocused();
	} finally {
		await unrelatedUpdates.evaluate(({ observer }) => observer.disconnect());
		await unrelatedUpdates.dispose();
	}
});
