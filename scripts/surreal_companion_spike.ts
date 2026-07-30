import { OutlineService } from "../src/services/outline_service.ts";
import { SurrealGraphStore } from "../src/storage/surreal_store.ts";
import { Surreal } from "surrealdb";

// SurrealGraphStore currently owns this namespace/database selection internally.
// Keep the CLI side aligned so the spike exports the database populated by the store.
const namespace = "radiora_v2";
const database = "main";
const username = "root";
const password = "root";
const expectedText = [
	"# 日本語の親\n\n**Markdown** と `radiora://item/child` を保持する。",
	"子ノード: [内部リンク](radiora://item/parent)",
];

type RunningServer = {
	process: Deno.ChildProcess;
	httpEndpoint: string;
	wsEndpoint: string;
};

type Snapshot = {
	items: Array<{ id: string; workId: string; text: string; parentId: string | null }>;
	links: Array<{ fromId: string; toId: string; type: string }>;
};

async function run(
	command: string,
	args: string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<string> {
	const output = await new Deno.Command(command, {
		args,
		cwd: options.cwd,
		env: options.env,
		stdout: "piped",
		stderr: "piped",
	}).output();
	const stdout = new TextDecoder().decode(output.stdout).trim();
	const stderr = new TextDecoder().decode(output.stderr).trim();
	if (!output.success) {
		throw new Error(
			`${command} ${args.join(" ")} failed (${output.code})\n${stdout}\n${stderr}`,
		);
	}
	return [stdout, stderr].filter(Boolean).join("\n");
}

async function allocatePort(): Promise<number> {
	const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
	const port = (listener.addr as Deno.NetAddr).port;
	listener.close();
	return port;
}

async function waitUntilReady(httpEndpoint: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			if ((await fetch(`${httpEndpoint}/health`)).ok) return;
		} catch { /* still starting */ }
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`SurrealDB did not become ready: ${httpEndpoint}`);
}

async function startServer(storagePath: string): Promise<RunningServer> {
	const port = await allocatePort();
	const process = new Deno.Command("surreal", {
		args: [
			"start",
			"--user",
			username,
			"--pass",
			password,
			"--bind",
			`127.0.0.1:${port}`,
			`rocksdb:${storagePath}`,
		],
		stdout: "null",
		stderr: "null",
	}).spawn();
	const httpEndpoint = `http://127.0.0.1:${port}`;
	try {
		await waitUntilReady(httpEndpoint);
	} catch (cause) {
		try {
			process.kill("SIGTERM");
		} catch { /* already stopped */ }
		await process.status;
		throw cause;
	}
	return { process, httpEndpoint, wsEndpoint: `ws://127.0.0.1:${port}` };
}

async function stopServer(server: RunningServer | undefined): Promise<void> {
	if (!server) return;
	try {
		server.process.kill("SIGTERM");
	} catch { /* already stopped */ }
	await server.process.status;
}

function connectionArgs(server: RunningServer): string[] {
	return [
		"--endpoint",
		server.httpEndpoint,
		"--username",
		username,
		"--password",
		password,
		"--namespace",
		namespace,
		"--database",
		database,
	];
}

function kitConnectionArgs(server: RunningServer): string[] {
	return [
		"--host",
		server.httpEndpoint,
		"--user",
		username,
		"--pass",
		password,
		"--ns",
		namespace,
		"--db",
		database,
	];
}

function runKit(server: RunningServer, folder: string, args: string[]): Promise<string> {
	// SurrealKit 0.7.0 accepts --folder but does not propagate it into DbCfg.
	// SURREALDB_FOLDER is honored, so use it to keep every artifact in the temp directory.
	return run("surrealkit", [...args, ...kitConnectionArgs(server)], {
		env: { SURREALDB_FOLDER: folder },
	});
}

async function ensureEmptyDatabase(server: RunningServer): Promise<void> {
	const client = new Surreal();
	await client.connect(server.wsEndpoint, {
		authentication: { username, password },
	});
	await client.query(`
		DEFINE NAMESPACE IF NOT EXISTS ${namespace};
		USE NS ${namespace};
		DEFINE DATABASE IF NOT EXISTS ${database};
	`);
	await client.close();
}

async function createFixture(server: RunningServer): Promise<Snapshot> {
	const store = new SurrealGraphStore(server.wsEndpoint, username, password);
	await store.initialize();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: expectedText[0], parentId: null });
	const child = await service.createItem({ text: expectedText[1], parentId: root.id });
	await service.createLink({ fromId: root.id, toId: child.id, type: "CITE" });
	const snapshot = await takeSnapshot(service);
	await store.close();
	return snapshot;
}

async function takeSnapshot(service: OutlineService): Promise<Snapshot> {
	const outline = await service.listOutline();
	return {
		items: outline.items.map((item) => ({
			id: item.id,
			workId: item.workId,
			text: item.text,
			parentId: item.parentId,
		})).sort((left, right) => left.id.localeCompare(right.id)),
		links: outline.links.map((link) => ({
			fromId: link.fromId,
			toId: link.toId,
			type: link.type,
		})).sort((left, right) =>
			`${left.fromId}:${left.toId}:${left.type}`.localeCompare(
				`${right.fromId}:${right.toId}:${right.type}`,
			)
		),
	};
}

async function readSnapshot(server: RunningServer): Promise<Snapshot> {
	const store = new SurrealGraphStore(server.wsEndpoint, username, password);
	await store.initialize();
	const snapshot = await takeSnapshot(new OutlineService(store));
	await store.close();
	return snapshot;
}

function assertRestored(source: Snapshot, target: Snapshot): void {
	if (JSON.stringify(source) !== JSON.stringify(target)) {
		throw new Error(
			`Restored snapshot mismatch\nsource=${JSON.stringify(source)}\ntarget=${
				JSON.stringify(target)
			}`,
		);
	}
	if (target.items.length !== 2 || target.links.length !== 1) {
		throw new Error(`Unexpected restored counts: ${JSON.stringify(target)}`);
	}
	const root = target.items.find((item) => item.parentId === null);
	const child = target.items.find((item) => item.parentId !== null);
	if (
		!root || !child || child.parentId !== root.id ||
		root.text !== expectedText[0] || child.text !== expectedText[1]
	) {
		throw new Error(`Representative data was not preserved: ${JSON.stringify(target.items)}`);
	}
	const link = target.links[0];
	if (link.fromId !== root.workId || link.toId !== child.workId || link.type !== "CITE") {
		throw new Error(`Link direction was not preserved: ${JSON.stringify(link)}`);
	}
}

function schemaDefinitionsFromExport(dump: string): string {
	const withoutComments = dump.split(/\r?\n/)
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n");
	const definitions = withoutComments.split(";")
		.map((statement) => statement.trim())
		.filter((statement) => statement.startsWith("DEFINE "))
		.map((statement) => `${statement};`);
	if (definitions.length === 0) {
		throw new Error("No DEFINE statements found in schema export");
	}
	return `${definitions.join("\n\n")}\n`;
}

const tempDir = await Deno.makeTempDir({ prefix: "radiora-surreal-companion-" });
const separator = Deno.build.os === "windows" ? "\\" : "/";
const sourcePath = `${tempDir}${separator}source.db`;
const targetPath = `${tempDir}${separator}target.db`;
const dumpPath = `${tempDir}${separator}radiora-export.surql`;
const kitRoot = `${tempDir}${separator}surrealkit`;
const kitDatabase = `${kitRoot}${separator}database`;
const kitSchema = `${kitDatabase}${separator}schema`;
const rawSchemaPath = `${tempDir}${separator}radiora-schema-export.surql`;
const schemaPath = `${kitSchema}${separator}current.surql`;
let sourceServer: RunningServer | undefined;
let targetServer: RunningServer | undefined;

try {
	await Deno.mkdir(kitSchema, { recursive: true });

	sourceServer = await startServer(sourcePath);
	const sourceSnapshot = await createFixture(sourceServer);

	await run("surreal", [
		"export",
		...connectionArgs(sourceServer),
		"--only",
		"--analyzers",
		"true",
		"--tables",
		"true",
		"--records",
		"false",
		rawSchemaPath,
	]);
	await Deno.writeTextFile(
		schemaPath,
		schemaDefinitionsFromExport(await Deno.readTextFile(rawSchemaPath)),
	);
	await run("surreal", ["validate", schemaPath]);
	const exportedSchema = await Deno.readTextFile(schemaPath);
	if (!exportedSchema.includes("DEFINE TABLE work")) {
		throw new Error(`Schema export did not include Radiora tables:\n${exportedSchema}`);
	}

	await runKit(sourceServer, kitDatabase, ["setup"]);
	const baselineOutput = await runKit(sourceServer, kitDatabase, [
		"rollout",
		"baseline",
		"--verbose",
	]);
	if (/0 schema file\(s\)|0 managed object\(s\)/.test(baselineOutput)) {
		throw new Error(
			`SurrealKit did not baseline the exported Radiora schema: ${baselineOutput}\n` +
				exportedSchema.slice(0, 2_000),
		);
	}
	const statusOutput = await runKit(sourceServer, kitDatabase, [
		"status",
	]);

	await run("surreal", [
		"export",
		...connectionArgs(sourceServer),
		"--only",
		"--analyzers",
		"true",
		"--tables",
		"true",
		"--records",
		"true",
		dumpPath,
	]);
	await run("surreal", ["validate", dumpPath]);

	targetServer = await startServer(targetPath);
	await ensureEmptyDatabase(targetServer);
	await run("surreal", ["import", ...connectionArgs(targetServer), dumpPath]);
	const targetSnapshot = await readSnapshot(targetServer);
	assertRestored(sourceSnapshot, targetSnapshot);

	console.log(JSON.stringify({
		ok: true,
		surrealKitBaseline: true,
		exportValidated: true,
		counts: {
			items: targetSnapshot.items.length,
			links: targetSnapshot.links.length,
		},
		representativeData: {
			ids: true,
			linkDirection: true,
			japaneseMarkdown: true,
		},
		baselineOutput,
		statusOutput,
	}));
} finally {
	await stopServer(targetServer);
	await stopServer(sourceServer);
	await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
}
