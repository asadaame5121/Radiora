import { createBindingHandlers } from "./desktop/register_bindings.ts";
import { SurrealProcess } from "./desktop/surreal_process.ts";
import { OutlineService } from "./services/outline_service.ts";
import type { StartupStatus } from "./shared/bindings.ts";
import type { GraphStore } from "./storage/graph_store.ts";
import { JsonGraphStore } from "./storage/json_store.ts";
import { prepareStorageMigrationBackup, recordStorageVersion } from "./storage/migration_backup.ts";
import { CURRENT_STORAGE_SCHEMA_VERSION } from "./storage/migrations/mod.ts";

const appData = Deno.env.get("LOCALAPPDATA") ?? Deno.env.get("APPDATA") ?? Deno.cwd();
const dataDir = `${appData}\\RadioraV2`;
const logDir = `${dataDir}\\logs`;
const logPath = `${logDir}\\startup.log`;
const storageMode = Deno.env.get("RADIORA_STORAGE") ?? "surreal";
const surrealPort = Number(Deno.env.get("RADIORA_SURREAL_PORT") ?? "8012");
await Deno.mkdir(logDir, { recursive: true });

let startupStatus: StartupStatus = {
	phase: "starting",
	message: "Radioraを起動しています…",
	logPath,
};
let service: OutlineService | null = null;
let store: GraphStore | null = null;
let surrealProcess: SurrealProcess | null = null;
let bootstrapPromise: Promise<StartupStatus> | null = null;

async function log(message: string, cause?: unknown): Promise<void> {
	const detail = cause instanceof Error
		? `${cause.message}\n${cause.stack ?? ""}`
		: cause == null
		? ""
		: typeof cause === "string"
		? cause
		: JSON.stringify(cause);
	const line = `[${new Date().toISOString()}] ${message}${detail ? `\n${detail}` : ""}\n`;
	try {
		Deno.writeTextFileSync(logPath, line, { append: true, create: true });
	} catch {
		// Diagnostics must not change startup behavior.
	}
}

async function stopBackend(): Promise<void> {
	service = null;
	const activeStore = store;
	const activeProcess = surrealProcess;
	store = null;
	surrealProcess = null;
	await activeStore?.close().catch((cause) => log("Failed to close store", cause));
	await activeProcess?.stop().catch((cause) => log("Failed to stop SurrealDB", cause));
}

async function bootstrap(): Promise<StartupStatus> {
	if (bootstrapPromise) return bootstrapPromise;
	bootstrapPromise = (async () => {
		startupStatus = { phase: "starting", message: "データを読み込んでいます…", logPath };
		await log("Backend startup began");
		await stopBackend();
		try {
			let nextStore: GraphStore;
			let storageVersionMarker: string | null = null;
			if (storageMode === "json") {
				nextStore = new JsonGraphStore(`${dataDir}\\radiora-v2.json`);
			} else if (storageMode === "surreal" || storageMode === "surreal-diagnostic") {
				if (!Number.isInteger(surrealPort) || surrealPort < 1 || surrealPort > 65535) {
					throw new Error(`Invalid RADIORA_SURREAL_PORT: ${surrealPort}`);
				}
				const surrealDir = storageMode === "surreal"
					? `${dataDir}\\surreal`
					: `${dataDir}\\surreal-diagnostic`;
				await Deno.mkdir(surrealDir, { recursive: true });
				const databasePath = `${surrealDir}\\main.db`;
				storageVersionMarker = `${surrealDir}\\storage-schema-version`;
				const backupPath = `${surrealDir}\\migration-backups\\storage-v0`;
				const protectedBackup = await prepareStorageMigrationBackup(
					databasePath,
					backupPath,
					storageVersionMarker,
					CURRENT_STORAGE_SCHEMA_VERSION,
				);
				if (protectedBackup) {
					await log("Storage migration backup ready", { path: protectedBackup });
				}
				const nextProcess = new SurrealProcess(
					databasePath,
					"127.0.0.1",
					surrealPort,
					(event, detail) => void log(`SurrealDB ${event}`, detail),
				);
				surrealProcess = nextProcess;
				await nextProcess.start();
				await log("SurrealDB sdk.import.begin");
				const { SurrealGraphStore } = await import("./storage/surreal_store.ts");
				await log("SurrealDB sdk.import.ready");
				nextStore = new SurrealGraphStore(
					nextProcess.endpoint,
					"root",
					"root",
					(event, detail) => void log(`SurrealDB ${event}`, detail),
				);
			} else {
				throw new Error(`Unknown RADIORA_STORAGE mode: ${storageMode}`);
			}
			store = nextStore;
			await nextStore.initialize();
			if (storageVersionMarker) {
				await recordStorageVersion(storageVersionMarker, CURRENT_STORAGE_SCHEMA_VERSION);
			}
			service = new OutlineService(nextStore);
			startupStatus = { phase: "ready", message: "準備完了", logPath };
			await log("Backend startup completed");
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			startupStatus = {
				phase: "failed",
				message: "データを読み込めませんでした。",
				detail,
				logPath,
			};
			await log("Backend startup failed", cause);
			await stopBackend();
		}
		return startupStatus;
	})().finally(() => {
		bootstrapPromise = null;
	});
	return bootstrapPromise;
}

const distRoot = new URL("../dist/", import.meta.url);
const mimeTypes: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
};

function extension(path: string): string {
	const index = path.lastIndexOf(".");
	return index < 0 ? "" : path.slice(index);
}

function missingAssetResponse(path: string): Response {
	const body =
		`<!doctype html><html lang="ja"><meta charset="utf-8"><title>Radiora 起動エラー</title>
	<style>body{font:16px system-ui;background:#111310;color:#deddd6;padding:48px;line-height:1.7}code{color:#ffb8af}</style>
	<h1>Radioraを表示できません</h1><p>UIファイル <code>${path}</code> がbundleに含まれていません。</p>
	<p><code>deno task desktop</code> で再ビルドしてください。</p></html>`;
	return new Response(body, {
		status: 500,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

const handlers = createBindingHandlers({
	getService: () => service,
	getStartupStatus: () => startupStatus,
	retryStartup: bootstrap,
});
await log("Desktop runtime initialized; waiting for the UI server", { storageMode, surrealPort });

addEventListener("unload", () => {
	void stopBackend();
});

// In desktop mode Deno.serve owns the runtime loop. Keep it as the final
// operation so window setup, bindings, diagnostics, and bootstrap always run.
const server = Deno.serve(async (request) => {
	const url = new URL(request.url);
	if (url.pathname === "/api/renderer-log" && request.method === "POST") {
		const message = await request.text().catch(() => "<unreadable renderer message>");
		await log(`Renderer: ${message}`);
		return new Response(null, { status: 204 });
	}
	if (url.pathname.startsWith("/api/rpc/")) {
		const name = url.pathname.slice("/api/rpc/".length) as keyof typeof handlers;
		if (name === "getStartupStatus" && startupStatus.phase === "starting" && !bootstrapPromise) {
			void bootstrap();
		}
		const handler = handlers[name] as ((...args: unknown[]) => unknown) | undefined;
		if (request.method !== "POST" || !handler) {
			return Response.json({ message: "Unknown API method." }, { status: 404 });
		}
		try {
			const body = await request.json() as { args?: unknown[] };
			const result = await handler(...(body.args ?? []));
			await log(`API ${name} -> 200`);
			return Response.json({ result: result ?? null });
		} catch (cause) {
			await log(`API call failed: ${name}`, cause);
			return Response.json({ message: cause instanceof Error ? cause.message : String(cause) }, {
				status: 500,
			});
		}
	}
	const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
	const safePath = relative.includes("..") ? "index.html" : relative;
	const assetUrl = new URL(safePath, distRoot);
	try {
		const body = await Deno.readFile(assetUrl);
		await log(
			`HTTP ${request.method} ${url.pathname} -> 200 ${body.byteLength}B (${assetUrl.href})`,
		);
		return new Response(body, {
			headers: { "content-type": mimeTypes[extension(safePath)] ?? "application/octet-stream" },
		});
	} catch (cause) {
		await log(
			`HTTP ${request.method} ${url.pathname} -> asset read failed (${assetUrl.href})`,
			cause,
		);
		if (safePath !== "index.html") return missingAssetResponse(safePath);
		return missingAssetResponse("dist/index.html");
	}
});
await server.finished;
