// biome-ignore-all lint/style/noMagicNumbers: Ports, byte sizes, and attempt counts are protocol inputs.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createSmokeAttempt, type SmokeAttempt, startSqliteHost } from "./test_host_process.ts";

const encoder = new TextEncoder();
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded poll; readiness and lifecycle checks never sleep a fixed interval. */
async function waitUntil(
	condition: () => boolean,
	timeoutMs: number,
	message: string,
): Promise<void> {
	const started = performance.now();
	while (!condition()) {
		if (performance.now() - started > timeoutMs) throw new Error(message);
		await delay(10);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FixtureDist {
	readonly dir: string;
	readonly indexMarker: string;
}

/** Writes a controlled stand-in for a built `dist` directory plus one file outside it. */
async function createFixtureDist(root: string): Promise<FixtureDist> {
	const dir = `${root}\\dist-fixture #%`;
	const indexMarker = "radiora-smoke-fixture-index";
	await Deno.mkdir(`${dir}\\assets`, { recursive: true });
	await Deno.writeTextFile(
		`${dir}\\index.html`,
		`<!doctype html><html><body>${indexMarker}</body></html>\n`,
	);
	await Deno.writeTextFile(`${dir}\\assets\\app.js`, "export const fixture = true;\n");
	await Deno.writeTextFile(`${dir}\\assets\\styles.css`, "body { color: inherit; }\n");
	await Deno.writeTextFile(`${dir}\\assets\\unknown.bin`, "binary-ish\n");
	await Deno.writeTextFile(`${root}\\secret.txt`, "outside-dist-secret\n");
	return { dir, indexMarker };
}

async function rpcResponse(
	origin: string,
	method: string,
	args: unknown[] = [],
): Promise<Response> {
	return await fetch(`${origin}/api/rpc/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ args }),
	});
}

async function rpc(origin: string, method: string, args: unknown[] = []): Promise<unknown> {
	const response = await rpcResponse(origin, method, args);
	const payload: unknown = await response.json();
	if (!response.ok) {
		const message = isRecord(payload) && typeof payload.message === "string"
			? payload.message
			: `HTTP ${response.status}`;
		throw new Error(`${method} failed: ${message}`);
	}
	return isRecord(payload) ? payload.result : undefined;
}

function startupPhase(value: unknown): string {
	return isRecord(value) && typeof value.phase === "string" ? value.phase : "";
}

function outlineTexts(value: unknown): string[] {
	if (!isRecord(value) || !Array.isArray(value.items)) return [];
	return value.items.flatMap((item) =>
		isRecord(item) && typeof item.text === "string" ? [item.text] : []
	);
}

function createdItemId(value: unknown): string {
	if (!isRecord(value) || typeof value.id !== "string") {
		throw new Error(`createItem did not return an item id: ${JSON.stringify(value)}`);
	}
	return value.id;
}

function sqlitePath(attempt: { readonly dataDir: string }): string {
	return `${attempt.dataDir}\\turso\\radiora.db`;
}

/** The test host deliberately omits the startup snapshot cache ports. */
async function assertNoSnapshotCache(attempt: { readonly dataDir: string }): Promise<void> {
	await assertRejects(
		() => Deno.stat(`${attempt.dataDir}\\startup-snapshot.json`),
		Deno.errors.NotFound,
	);
}

async function cleanupAttempts(attempts: readonly SmokeAttempt[]): Promise<void> {
	let failure: unknown;
	for (const attempt of attempts) {
		try {
			await attempt.cleanup();
		} catch (cause) {
			failure ??= cause;
		}
	}
	if (failure) throw failure;
}

/** Sends a raw HTTP request line so path segments reach the server unnormalized. */
async function rawRequest(port: number, requestLine: string): Promise<string> {
	const connection = await Deno.connect({ hostname: "127.0.0.1", port });
	try {
		const request = `${requestLine}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`;
		await connection.write(encoder.encode(request));
		const chunks: Uint8Array[] = [];
		const buffer = new Uint8Array(4096);
		while (true) {
			const read = await connection.read(buffer);
			if (read === null) break;
			chunks.push(buffer.slice(0, read));
		}
		const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}
		return new TextDecoder().decode(merged);
	} finally {
		connection.close();
	}
}

Deno.test("smoke host round-trips a saved value through the same temp SQLite after a restart", async () => {
	const attempt = await createSmokeAttempt("roundtrip");
	try {
		const dist = await createFixtureDist(attempt.root);
		let host = await attempt.start(dist.dir);
		assertEquals(startupPhase(await rpc(host.origin, "getStartupStatus")), "ready");
		const created = await rpc(host.origin, "createItem", [{ text: "保存前", parentId: null }]);
		await rpc(host.origin, "updateItemText", [createdItemId(created), "smoke 永続値"]);

		const db = await Deno.stat(sqlitePath(attempt));
		assert(
			db.isFile && db.size > 0,
			"sqlite file must exist and be non-empty inside the owned root",
		);
		await assertNoSnapshotCache(attempt);

		assertEquals(await host.stop(), 0);
		const originBefore = host.origin;
		host = await attempt.start(dist.dir);
		assertEquals(host.origin, originBefore);
		assertEquals(startupPhase(await rpc(host.origin, "getStartupStatus")), "ready");

		const texts = outlineTexts(await rpc(host.origin, "listOutline"));
		assert(
			texts.includes("smoke 永続値"),
			`persisted text must come back, saw ${JSON.stringify(texts)}`,
		);
		await assertNoSnapshotCache(attempt);
	} finally {
		await attempt.cleanup();
	}
	await assertRejects(() => Deno.stat(attempt.root), Deno.errors.NotFound);
});

Deno.test("smoke host attempts keep separate data roots and ports in parallel", async () => {
	const first = await createSmokeAttempt("parallel-a");
	const second = await createSmokeAttempt("parallel-b");
	try {
		const firstDist = await createFixtureDist(first.root);
		const secondDist = await createFixtureDist(second.root);
		const [firstHost, secondHost] = await Promise.all([
			first.start(firstDist.dir),
			second.start(secondDist.dir),
		]);
		assert(firstHost.port !== secondHost.port, "attempts must not share a port");
		await rpc(firstHost.origin, "createItem", [{ text: "attempt A", parentId: null }]);
		await rpc(secondHost.origin, "createItem", [{ text: "attempt B", parentId: null }]);
		const [firstTexts, secondTexts] = await Promise.all([
			outlineTexts(await rpc(firstHost.origin, "listOutline")),
			outlineTexts(await rpc(secondHost.origin, "listOutline")),
		]);
		assert(firstTexts.includes("attempt A") && !firstTexts.includes("attempt B"));
		assert(secondTexts.includes("attempt B") && !secondTexts.includes("attempt A"));
		assert((await Deno.stat(sqlitePath(first))).size > 0);
		assert((await Deno.stat(sqlitePath(second))).size > 0);
	} finally {
		await cleanupAttempts([first, second]);
	}
});

Deno.test("smoke host refuses unowned data directories and occupied ports without disturbing other listeners", async () => {
	const stray = await createSmokeAttempt("guard-stray");
	try {
		const dist = await createFixtureDist(stray.root);
		await Deno.writeTextFile(`${stray.dataDir}\\stray.txt`, "not ours\n");
		await assertRejects(() => stray.start(dist.dir), Error, "Refusing");
	} finally {
		await stray.cleanup();
	}

	const owned = await createSmokeAttempt("guard-token");
	try {
		const dist = await createFixtureDist(owned.root);
		const host = await owned.start(dist.dir);
		await assertRejects(
			() =>
				startSqliteHost({
					dataDir: owned.dataDir,
					token: crypto.randomUUID(),
					port: owned.port,
					distDir: dist.dir,
				}),
			Error,
			"token mismatch",
		);
		assertEquals(startupPhase(await rpc(host.origin, "getStartupStatus")), "ready");
	} finally {
		await owned.cleanup();
	}

	const occupied = await createSmokeAttempt("guard-port");
	const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
	try {
		const dist = await createFixtureDist(occupied.root);
		const address = listener.addr;
		assert(address.transport === "tcp", "expected a TCP listener");
		await assertRejects(
			() =>
				startSqliteHost({
					dataDir: occupied.dataDir,
					token: occupied.token,
					port: address.port,
					distDir: dist.dir,
				}),
			Error,
			"could not listen",
		);
		assertEquals(listener.addr.port, address.port);
	} finally {
		listener.close();
		await occupied.cleanup();
	}
});

Deno.test("smoke host serves built assets inside the dist root and guards traversal", async () => {
	const attempt = await createSmokeAttempt("assets");
	try {
		const dist = await createFixtureDist(attempt.root);
		const host = await attempt.start(dist.dir);
		const index = await fetch(`${host.origin}/`);
		assertEquals(index.status, 200);
		assertEquals(index.headers.get("content-type"), "text/html; charset=utf-8");
		assert((await index.text()).includes(dist.indexMarker));

		const script = await fetch(`${host.origin}/assets/app.js`);
		assertEquals(script.headers.get("content-type"), "text/javascript; charset=utf-8");
		const style = await fetch(`${host.origin}/assets/styles.css`);
		assertEquals(style.headers.get("content-type"), "text/css; charset=utf-8");
		const binary = await fetch(`${host.origin}/assets/unknown.bin`);
		assertEquals(binary.headers.get("content-type"), "application/octet-stream");

		const head = await fetch(`${host.origin}/`, { method: "HEAD" });
		assertEquals(head.status, 200);
		assertEquals(await head.text(), "");

		const missing = await fetch(`${host.origin}/missing.js`);
		assertEquals(missing.status, 500);
		assert((await missing.text()).includes("missing.js"));

		const rejectedMethod = await fetch(`${host.origin}/assets/app.js`, { method: "POST" });
		assertEquals(rejectedMethod.status, 405);

		for (const target of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"]) {
			const raw = await rawRequest(host.port, `GET ${target} HTTP/1.1`);
			assert(raw.startsWith("HTTP/1.1"), `expected an HTTP response for ${target}`);
			assert(!raw.includes("outside-dist-secret"), `${target} must not read outside the dist root`);
		}

		const rendererLog = await fetch(`${host.origin}/api/renderer-log`, {
			method: "POST",
			body: "Svelte app mounted",
		});
		assertEquals(rendererLog.status, 204);
		// The production record selector drops renderer.log info lines, so stdout evidence comes
		// from the host's own storage log line instead.
		assert(host.stdout.includes("test_host.storage.ready"), "host must mirror real log records");
	} finally {
		await attempt.cleanup();
	}
});

const READY_LINE =
	'console.log(JSON.stringify({ event: "test_host.ready", origin: "http://127.0.0.1:1", port: 1, pid: Deno.pid }));';
const NATURAL_EXIT_PROGRAM = `${READY_LINE} setTimeout(() => Deno.exit(0), 300);`;
const FAILING_PROGRAM = 'console.error("boom from startup"); Deno.exit(7);';
const HANGING_PROGRAM = `${READY_LINE} process.stdin.destroy(); setInterval(() => {}, 1000);`;

Deno.test("smoke host controller bounds every stop path for its own child only", async () => {
	const attempt = await createSmokeAttempt("lifecycle");
	try {
		const dist = await createFixtureDist(attempt.root);
		const host = await attempt.start(dist.dir);
		assertEquals(await host.stop(), 0);
		assertEquals(await host.stop(), 0);
	} finally {
		await attempt.cleanup();
	}

	const natural = await createSmokeAttempt("lifecycle-natural");
	try {
		const host = await startSqliteHost({
			dataDir: natural.dataDir,
			token: natural.token,
			distDir: natural.root,
			launch: { args: ["eval", NATURAL_EXIT_PROGRAM] },
		});
		await waitUntil(() => host.exited, 5_000, "child did not exit on its own");
		assertEquals(await host.stop(), 0);
	} finally {
		await natural.cleanup();
	}

	const failing = await createSmokeAttempt("lifecycle-failure");
	try {
		const failure = await assertRejects(
			() =>
				startSqliteHost({
					dataDir: failing.dataDir,
					token: failing.token,
					distDir: failing.root,
					launch: { args: ["eval", FAILING_PROGRAM] },
				}),
			Error,
			"exited before readiness",
		);
		assert(
			failure.message.includes("boom from startup"),
			"the last stderr line must reach the startup artifact",
		);
	} finally {
		await failing.cleanup();
	}

	const hanging = await createSmokeAttempt("lifecycle-timeout");
	try {
		const host = await startSqliteHost({
			dataDir: hanging.dataDir,
			token: hanging.token,
			distDir: hanging.root,
			launch: { args: ["eval", HANGING_PROGRAM] },
		});
		const first = await assertRejects(() => host.stop(), Error, "SIGKILL");
		assert(first.message.includes("--- host stdout ---"), "stop failures carry artifacts");
		await assertRejects(() => host.stop(), Error, "SIGKILL");
		assert(host.exited, "the bounded kill must leave no live child");
	} finally {
		await hanging.cleanup();
	}
});

Deno.test("smoke attempt cleanup owns in-flight starts and rejects later starts", async () => {
	const attempt = await createSmokeAttempt("cleanup-race");
	const dist = await createFixtureDist(attempt.root);
	const order: string[] = [];
	let startOutcome: unknown;
	const startSettled = attempt.start(dist.dir).then(
		() => order.push("start"),
		(cause: unknown) => {
			startOutcome = cause;
			order.push("start");
		},
	);
	const cleanups = [
		attempt.cleanup().then(() => order.push("cleanup-1")),
		attempt.cleanup().then(() => order.push("cleanup-2")),
	];
	await Promise.all([startSettled, ...cleanups]);

	assert(
		order[0] === "start",
		`start must settle before cleanup completes, saw ${order.join(",")}`,
	);
	assert(order.includes("cleanup-1") && order.includes("cleanup-2"));
	assert(
		startOutcome instanceof Error,
		`start must fail during cleanup, saw ${String(startOutcome)}`,
	);
	assert(startOutcome.message.includes("is cleaning up"), startOutcome.message);
	await assertRejects(() => Deno.stat(attempt.root), Deno.errors.NotFound);

	await assertRejects(() => attempt.start(dist.dir), Error, "cleaning up");
	await assertRejects(() => Deno.stat(attempt.root), Deno.errors.NotFound);
});

Deno.test("smoke attempt cleanup removes its root after a failed start", async () => {
	const attempt = await createSmokeAttempt("cleanup-start-failure");
	const dist = await createFixtureDist(attempt.root);
	try {
		await Deno.writeTextFile(`${attempt.dataDir}\\stray.txt`, "not ours\n");
		await assertRejects(() => attempt.start(dist.dir), Error, "Refusing");
	} finally {
		await attempt.cleanup();
	}
	await assertRejects(() => Deno.stat(attempt.root), Deno.errors.NotFound);
});
