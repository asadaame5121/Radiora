/**
 * Proof that the smoke controller runs under Node, not only Deno: Stage 3's Playwright fixture
 * imports this module from a plain Node process.
 *
 * Run: node --experimental-strip-types tests/smoke/node_controller_check.ts
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSmokeAttempt } from "./test_host_process.ts";

const MARKER = "node-controller-proof";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(value: unknown): string {
	if (!isRecord(value) || typeof value.id !== "string") {
		throw new Error(`missing item id: ${JSON.stringify(value)}`);
	}
	return value.id;
}

function outlineTexts(value: unknown): string[] {
	if (!isRecord(value) || !Array.isArray(value.items)) return [];
	return value.items.flatMap((item) =>
		isRecord(item) && typeof item.text === "string" ? [item.text] : []
	);
}

async function rpc(origin: string, method: string, args: unknown[] = []): Promise<unknown> {
	const response = await fetch(`${origin}/api/rpc/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ args }),
	});
	const payload: unknown = await response.json();
	if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`);
	return isRecord(payload) ? payload.result : undefined;
}

/** Fails unless the owned root is gone; only a missing path counts as removed. */
async function assertRemoved(path: string): Promise<void> {
	try {
		await stat(path);
	} catch (cause) {
		if (isRecord(cause) && cause.code === "ENOENT") return;
		throw cause;
	}
	throw new Error(`path was not removed: ${path}`);
}

const attempt = await createSmokeAttempt("node-proof");
try {
	const distDir = join(attempt.root, "dist-fixture #%");
	await mkdir(join(distDir, "assets"), { recursive: true });
	await writeFile(join(distDir, "index.html"), `<!doctype html><body>${MARKER}</body>\n`);

	let host = await attempt.start(distDir);
	const index = await fetch(`${host.origin}/`);
	if (!index.ok || !(await index.text()).includes(MARKER)) {
		throw new Error("the host did not serve the fixture index");
	}
	const created = await rpc(host.origin, "createItem", [{ text: "before", parentId: null }]);
	await rpc(host.origin, "updateItemText", [requireId(created), MARKER]);
	const db = await stat(join(attempt.dataDir, "turso", "radiora.db"));
	if (!db.isFile() || db.size === 0) throw new Error("sqlite file is missing or empty");

	const firstCode = await host.stop();
	if (firstCode !== 0) throw new Error(`first stop returned ${firstCode}`);
	host = await attempt.start(distDir);
	const texts = outlineTexts(await rpc(host.origin, "listOutline"));
	if (!texts.includes(MARKER)) throw new Error(`persisted text missing: ${JSON.stringify(texts)}`);
	const secondCode = await host.stop();
	if (secondCode !== 0) throw new Error(`second stop returned ${secondCode}`);
} finally {
	await attempt.cleanup();
}
await assertRemoved(attempt.root);
console.log("node controller check passed");
