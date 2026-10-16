/**
 * Minimal full-stack smoke for Issue #329: one browser session, the real RPC boundary, the
 * real SQLite backend, a backend process restart, and a reload that must show persisted data.
 *
 * Everything asserted below comes through the product's own paths — no `page.route`, no mock
 * Vite plugin, no fabricated handler/service/store, and no DOM writes to fake persistence.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./smoke_fixture";

const ITEM_TITLE = "スモーク項目";
const SAVED_TEXT = "スモークで保存した本文";
const SNAPSHOT_CACHE = "startup-snapshot.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Real RPC readiness: the same POST the UI polls, answered by the real backend. */
async function startupPhase(origin: string): Promise<unknown> {
	const response = await fetch(`${origin}/api/rpc/getStartupStatus`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ args: [] }),
	});
	expect(response.ok).toBe(true);
	const payload: unknown = await response.json();
	if (!isRecord(payload) || !isRecord(payload.result)) return undefined;
	return payload.result.phase;
}

function createdItemId(payload: unknown): string {
	if (!isRecord(payload) || !isRecord(payload.result) || typeof payload.result.id !== "string") {
		throw new Error(`createItem returned no item id: ${JSON.stringify(payload)}`);
	}
	return payload.result.id;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (cause) {
		// Only a missing path counts as absent; permission or I/O errors must fail the smoke.
		if (isRecord(cause) && cause.code === "ENOENT") return false;
		throw cause;
	}
}

test("saved outline text survives a backend process restart", async ({ page, smoke }) => {
	expect(await startupPhase(smoke.origin)).toBe("ready");

	await page.goto(`${smoke.origin}/`, { waitUntil: "domcontentloaded" });
	await expect(page.locator(".shell")).not.toHaveAttribute("inert", "");

	// Create through the real top-bar quick capture: Shift+Enter saves at the root.
	const created = page.waitForResponse((response) =>
		response.url().includes("/api/rpc/createItem") &&
		(response.request().postData()?.includes(ITEM_TITLE) ?? false)
	);
	await page.getByRole("combobox").fill(ITEM_TITLE);
	await page.getByRole("combobox").press("Shift+Enter");
	const createdResponse = await created;
	expect(createdResponse.ok()).toBe(true);
	const itemId = createdItemId(await createdResponse.json());

	// Type the body in the real editor and observe the real save request.
	const rowEditor = page.locator(`.markdown-editor-host[data-editor-item-id="${itemId}"]`);
	await expect(rowEditor).toBeVisible();
	await rowEditor.click();
	const editor = page.locator(`textarea[data-item-id="${itemId}"]`);
	await expect(editor).toBeFocused();
	const saved = page.waitForResponse((response) =>
		response.url().includes("/api/rpc/updateItemText") &&
		(response.request().postData()?.includes(SAVED_TEXT) ?? false)
	);
	await editor.fill(SAVED_TEXT);
	expect((await saved).ok()).toBe(true);
	await expect(page.locator(".working-copy-save-status")).not.toHaveClass(/failed|pending/);

	// The write is on disk inside the owned root, and no startup snapshot cache exists.
	expect((await stat(join(smoke.dataDir, "turso", "radiora.db"))).size).toBeGreaterThan(0);
	expect(await exists(join(smoke.dataDir, SNAPSHOT_CACHE))).toBe(false);

	// Replace the backend process on the same origin, then reload the page.
	await smoke.restart();
	expect(await startupPhase(smoke.origin)).toBe("ready");
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator(".shell")).not.toHaveAttribute("inert", "");

	const persistedRow = page.getByRole("treeitem").filter({
		has: page.locator(`[data-editor-item-id="${itemId}"]`),
	});
	await expect(persistedRow).toContainText(SAVED_TEXT);
	// No cache file exists, so the reloaded text can only come from the restarted backend's SQLite.
	expect(await exists(join(smoke.dataDir, SNAPSHOT_CACHE))).toBe(false);
});
