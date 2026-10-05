import { expect, test } from "@playwright/test";

test("Outline focus dispatch reaches the rendered editor and restores its caret", async ({ page }) => {
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const editor = page.locator("textarea[data-item-id]").first();
	await expect(editor).toBeAttached();
	const id = await editor.getAttribute("data-item-id");
	if (!id) throw new Error("Missing editor occurrence ID");
	await page.evaluate(async (itemId) => {
		const moduleUrl = "/src/ui/outline_focus_adapter.ts";
		const { OutlineFocusAdapter } = await import(moduleUrl);
		const adapter = new OutlineFocusAdapter({
			context: () => ({ pane: "test", origin: 1 }),
			canFocus: () => true,
		});
		adapter.request(itemId, 3, () => true);
	}, id);
	await expect(editor).toBeFocused();
	await expect.poll(() => editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart))
		.toBe(3);
});

test("Outline focus uses CSS escaping and dispatches only to the requested DOM host", async ({ page }) => {
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const result = await page.evaluate(async () => {
		const moduleUrl = "/src/ui/outline_focus_adapter.ts";
		const { OutlineFocusAdapter } = await import(moduleUrl);
		const id = 'quote"slash\\bracket]';
		const host = document.createElement("div");
		host.className = "markdown-editor-host";
		host.dataset.editorItemId = id;
		const events: unknown[] = [];
		host.addEventListener("radiora:focus-editor", (event) => {
			if (event instanceof CustomEvent) events.push(event.detail);
		});
		document.body.append(host);
		const adapter = new OutlineFocusAdapter({
			context: () => ({ pane: "test", origin: 1 }),
			canFocus: () => true,
		});
		adapter.request(id, 4, () => true);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		adapter.dispose();
		host.remove();
		return events;
	});
	expect(result).toEqual([{ caretOffset: 4 }]);
});
