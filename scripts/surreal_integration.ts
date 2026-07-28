import { OutlineService } from "../src/services/outline_service.ts";
import { SurrealGraphStore } from "../src/storage/surreal_store.ts";
import { Surreal } from "surrealdb";

const port = 18012;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
	trace("integration.seed-v0.begin");
	const legacy = new Surreal();
	await legacy.connect(endpoint, {
		authentication: { username: "root", password: "root" },
	});
	await legacy.query(`
		DEFINE NAMESPACE IF NOT EXISTS radiora_v2;
		USE NS radiora_v2;
		DEFINE DATABASE IF NOT EXISTS main;
	`);
	await legacy.use({ namespace: "radiora_v2", database: "main" });
	await legacy.query(
		await Deno.readTextFile(new URL("../tests/fixtures/storage-v0.surql", import.meta.url)),
	);
	await legacy.query(`
		RELATE outline_item:\`11111111-1111-4111-8111-111111111111\`
			->in_knot->outline_item:\`22222222-2222-4222-8222-222222222222\`
			CONTENT { created_at: "2026-07-05T01:00:00.000Z" };
	`);
	await legacy.close();
	trace("integration.seed-v0.ready");

	let store = new SurrealGraphStore(endpoint, "root", "root", trace);
	await store.initialize();
	trace("integration.first-session.ready");
	let service = new OutlineService(store);
	trace("integration.create-root.begin");
	const root = await service.createItem({ text: "persisted root", parentId: null });
	if (!UUID_PATTERN.test(root.id)) {
		throw new Error(`Root ID is not a canonical UUID: ${root.id}`);
	}
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
	if (snapshot.items.length !== 7 || snapshot.links.length !== 2) {
		throw new Error(`Persistence verification failed: ${JSON.stringify(snapshot)}`);
	}
	const expectedStashIds = [
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
		"55555555-5555-4555-8555-555555555555",
	];
	if (
		expectedStashIds.some((id) => !snapshot.stashItemIds.includes(id)) ||
		snapshot.stashItemIds.some((id) => !expectedStashIds.includes(id))
	) {
		throw new Error(`Orphan and cycle isolation failed: ${JSON.stringify(snapshot)}`);
	}
	const migratedLegacy = snapshot.items.find((item) =>
		item.id === "11111111-1111-4111-8111-111111111111"
	);
	if (
		!migratedLegacy ||
		!migratedLegacy.text.includes("日本語・**Markdown**・radiora://item/") ||
		snapshot.links.some((link) => link.type === "FROM")
	) {
		throw new Error(`Version 0 migration verification failed: ${JSON.stringify(snapshot)}`);
	}
	const systemRelations = await store.listSystemRelations();
	if (
		systemRelations.length !== 1 ||
		systemRelations[0].type !== "IN" ||
		systemRelations[0].fromWorkId !== "11111111-1111-4111-8111-111111111111" ||
		systemRelations[0].toWorkId !== "22222222-2222-4222-8222-222222222222"
	) {
		throw new Error(`IN system relation migration failed: ${JSON.stringify(systemRelations)}`);
	}
	const persistedRoot = snapshot.items.find((item) => item.id === root.id);
	const persistedChild = snapshot.items.find((item) => item.id === child.id);
	if (
		!persistedRoot || !persistedChild ||
		!UUID_PATTERN.test(persistedRoot.id) ||
		!UUID_PATTERN.test(persistedChild.id) ||
		persistedChild.parentId !== persistedRoot.id ||
		!UUID_PATTERN.test(persistedChild.parentId)
	) {
		throw new Error(`UUID boundary verification failed: ${JSON.stringify(snapshot.items)}`);
	}
	const suggestions = await service.suggestItems("persist", 8);
	if (suggestions.length !== 2) {
		throw new Error(`Prefix suggestion verification failed: ${JSON.stringify(suggestions)}`);
	}
	const lexical = await service.searchItems({ query: "child", contextItemId: root.id });
	if (lexical[0]?.item.id !== child.id || !lexical[0].reasons.length) {
		throw new Error(`Lexical search verification failed: ${JSON.stringify(lexical)}`);
	}
	await service.saveSearchAlias({ canonical: "child", variants: ["offspring"] });
	const expanded = await service.searchItems({ query: "offspring", contextItemId: root.id });
	if (
		expanded[0]?.item.id !== child.id ||
		!expanded[0].reasons.some((reason) => reason.kind === "alias")
	) {
		throw new Error(`Alias search verification failed: ${JSON.stringify(expanded)}`);
	}
	const mirror = await service.createOccurrence({
		workId: root.workId,
		parentId: null,
		contextualHeading: "integration mirror",
	});
	await service.updateItemText(mirror.id, "persisted root shared");
	const shared = (await service.listOutline()).items.filter((item) => item.workId === root.workId);
	if (shared.length !== 2 || shared.some((item) => item.text !== "persisted root shared")) {
		throw new Error(`Shared WorkingCopy verification failed: ${JSON.stringify(shared)}`);
	}
	await service.deleteItem(mirror.id);
	await service.trashWork(root.id);
	if (!(await service.listTrash()).some((entry) => entry.work.id === root.workId)) {
		throw new Error("Trash verification failed");
	}
	await service.restoreWork(root.workId);
	const disposable = await service.createItem({ text: "must not enter manifest", parentId: null });
	await service.trashWork(disposable.id);
	const manifest = await service.purgeWork(disposable.workId);
	const manifests = await store.listPurgeManifests();
	if (
		!manifests.some((candidate) => candidate.id === manifest.id) ||
		JSON.stringify(manifest).includes("must not enter manifest")
	) {
		throw new Error(`Purge manifest verification failed: ${JSON.stringify(manifests)}`);
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
