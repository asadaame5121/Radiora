import { OutlineService } from "../src/services/outline_service.ts";
import { SurrealGraphStore } from "../src/storage/surreal_store.ts";

const port = 18012;
const endpoint = `ws://127.0.0.1:${port}`;
const tempDir = await Deno.makeTempDir({ prefix: "radiora-v2-" });
const databasePath = `${tempDir}${Deno.build.os === "windows" ? "\\" : "/"}test.db`;
const appData = Deno.env.get("LOCALAPPDATA");
const logDir = appData ? `${appData}\\RadioraV2\\logs` : Deno.cwd();
const logPath = Deno.env.get("RADIORA_SURREAL_LOG") ??
	`${logDir}${Deno.build.os === "windows" ? "\\" : "/"}surreal-diagnostic.log`;
Deno.mkdirSync(logDir, { recursive: true });

function formatDetail(detail: unknown): string {
	if (detail instanceof Error) return `${detail.name}: ${detail.message}\n${detail.stack ?? ""}`;
	if (detail === undefined) return "";
	try {
		return JSON.stringify(detail);
	} catch {
		return String(detail);
	}
}

function trace(event: string, detail?: unknown): void {
	const suffix = formatDetail(detail);
	const line = `[surreal-diagnostic ${new Date().toISOString()}] ${event}${
		suffix ? ` ${suffix}` : ""
	}\n`;
	try {
		Deno.writeTextFileSync(logPath, line, { append: true, create: true });
	} catch (cause) {
		console.error(`[surreal-diagnostic] Failed to write ${logPath}:`, cause);
	}
	console.error(line.trimEnd());
}

async function relayCliOutput(
	stream: ReadableStream<Uint8Array>,
	channel: "stdout" | "stderr",
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				pending += decoder.decode();
				if (pending) trace(`cli.${channel}`, pending);
				return;
			}
			pending += decoder.decode(value, { stream: true });
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (line) trace(`cli.${channel}`, line);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

console.error(`[surreal-diagnostic] persistent log: ${logPath}`);
trace("integration.begin", { endpoint, tempDir });
trace("process.spawn.begin");
const process = new Deno.Command("surreal", {
	args: [
		"start",
		"--user",
		"root",
		"--pass",
		"root",
		"--bind",
		`127.0.0.1:${port}`,
		`rocksdb:${databasePath}`,
	],
	stdout: "piped",
	stderr: "piped",
}).spawn();
trace("process.spawn.ready", { pid: process.pid });
const cliOutputTasks = [
	relayCliOutput(process.stdout, "stdout"),
	relayCliOutput(process.stderr, "stderr"),
];

async function waitUntilReady(): Promise<void> {
	trace("process.health.begin");
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
				trace("process.health.ready", { attempt: attempt + 1 });
				return;
			}
		} catch { /* still starting */ }
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error("Integration SurrealDB did not become ready");
}

try {
	await waitUntilReady();
	let store = new SurrealGraphStore(endpoint, "root", "root", trace);
	await store.initialize();
	trace("integration.first-session.ready");
	let service = new OutlineService(store);
	trace("integration.create-root.begin");
	const root = await service.createItem({ text: "persisted root", parentId: null });
	trace("integration.create-root.ready", { id: root.id });
	trace("integration.create-child.begin");
	const child = await service.createItem({ text: "persisted child", parentId: root.id });
	trace("integration.create-child.ready", { id: child.id });
	trace("integration.create-link.begin");
	await service.createLink({ fromId: root.id, toId: child.id, type: "LIKE" });
	trace("integration.create-link.ready");
	await store.close();
	trace("integration.first-session.closed");

	store = new SurrealGraphStore(endpoint, "root", "root", trace);
	await store.initialize();
	trace("integration.second-session.ready");
	service = new OutlineService(store);
	trace("integration.persistence-read.begin");
	const snapshot = await service.listOutline();
	trace("integration.persistence-read.ready", {
		items: snapshot.items.length,
		links: snapshot.links.length,
	});
	if (snapshot.items.length !== 2 || snapshot.links.length !== 1) {
		throw new Error(`Persistence verification failed: ${JSON.stringify(snapshot)}`);
	}
	await store.close();
	trace("integration.ready");
	console.log(
		JSON.stringify({ ok: true, items: snapshot.items.length, links: snapshot.links.length }),
	);
} catch (cause) {
	trace("integration.failed", cause);
	throw cause;
} finally {
	trace("integration.cleanup.begin");
	try {
		process.kill("SIGTERM");
	} catch { /* already stopped */ }
	await process.status;
	await Promise.allSettled(cliOutputTasks);
	await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
	trace("integration.cleanup.ready");
}
