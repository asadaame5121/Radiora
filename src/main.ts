import { createBindingHandlers } from "./desktop/register_bindings.ts";
import { SurrealProcess } from "./desktop/surreal_process.ts";
import { StartupSnapshotCacheFile } from "./desktop/startup_snapshot_cache_file.ts";
import { OutlineService } from "./services/outline_service.ts";
import { RevisionService } from "./services/revision_service.ts";
import { Logger } from "./services/logger.ts";
import type { StartupStatus } from "./shared/bindings.ts";
import type { GraphStore } from "./storage/graph_store.ts";
import { JsonGraphStore } from "./storage/json_store.ts";
import {
	prepareStorageMigrationBackup,
	recordStorageVersion,
	restoreStorageMigrationBackup,
} from "./storage/migration_backup.ts";
import { CURRENT_STORAGE_SCHEMA_VERSION } from "./storage/migrations/mod.ts";

const hmrUiOrigin = developmentUiOrigin(Deno.env.get("RADIORA_HMR_UI_ORIGIN"));
const hmrBridgeFile = Deno.env.get("RADIORA_HMR_BRIDGE_FILE");
if (hmrBridgeFile) {
	const serveAddress = Deno.env.get("DENO_SERVE_ADDRESS");
	if (!serveAddress) throw new Error("DENO_SERVE_ADDRESS is required for desktop HMR.");
	await Deno.writeTextFile(
		hmrBridgeFile,
		JSON.stringify({ backendOrigin: backendOriginFromServeAddress(serveAddress) }),
	);
}

const appData = Deno.env.get("LOCALAPPDATA") ?? Deno.env.get("APPDATA") ?? Deno.cwd();
const dataDir = `${appData}\\RadioraV2`;
const logDir = `${dataDir}\\logs`;
const logPath = `${logDir}\\startup.log`;
const startupSnapshotCachePath = `${dataDir}\\startup-snapshot.json`;
const storageMode = Deno.env.get("RADIORA_STORAGE") ?? "surreal";
const surrealPort = Number(Deno.env.get("RADIORA_SURREAL_PORT") ?? "8012");
await Deno.mkdir(logDir, { recursive: true });

const logger = new Logger({
	sink: (line) => {
		try {
			Deno.writeTextFileSync(logPath, `${line}\n`, { append: true, create: true });
			// biome-ignore lint/plugin/noSwallowedRejection: Logging falls back to stdout and must not prevent application startup.
		} catch {
			// Diagnostics must not change application behavior.
		}
	},
	stdout: (line) => console.log(line),
});
const startupSnapshotCache = new StartupSnapshotCacheFile(startupSnapshotCachePath);

if (Deno.build.os === "linux") {
	Deno.autoUpdate({
		onUpdateReady: (version) => logger.info("desktop.update.ready", { version }),
		onRollback: (reason) => logger.warn("desktop.update.rollback", { reason }),
	});
}

let startupStatus: StartupStatus = {
	phase: "starting",
	message: "Radioraを起動しています…",
	logPath,
};
let service: OutlineService | null = null;
let store: GraphStore | null = null;
let surrealProcess: SurrealProcess | null = null;
let bootstrapPromise: Promise<StartupStatus> | null = null;

async function stopBackend(): Promise<void> {
	service = null;
	const activeStore = store;
	const activeProcess = surrealProcess;
	store = null;
	surrealProcess = null;
	await activeStore?.close().catch((cause) => logger.error("store.close.failed", cause));
	await activeProcess?.stop().catch((cause) => logger.error("surrealdb.stop.failed", cause));
}

async function bootstrap(): Promise<StartupStatus> {
	if (bootstrapPromise) return bootstrapPromise;
	bootstrapPromise = logger.timed("backend.bootstrap", async () => {
		startupStatus = { phase: "starting", message: "データを読み込んでいます…", logPath };
		logger.info("backend.startup.begin", { storageMode, surrealPort });
		await stopBackend();
		let storageMigrationRecovery: {
			databasePath: string;
			backupPath: string;
			versionMarkerPath: string;
		} | null = null;
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
				const backupRoot = `${surrealDir}\\migration-backups`;
				const protectedBackup = await prepareStorageMigrationBackup(
					databasePath,
					backupRoot,
					storageVersionMarker,
					CURRENT_STORAGE_SCHEMA_VERSION,
				);
				if (protectedBackup) {
					storageMigrationRecovery = {
						databasePath,
						backupPath: protectedBackup,
						versionMarkerPath: storageVersionMarker,
					};
					logger.info("storage.migration_backup.ready", { path: protectedBackup });
				}
				const nextProcess = new SurrealProcess(
					databasePath,
					"127.0.0.1",
					surrealPort,
					(event, detail) => logger.info("surrealdb.event", { sourceEvent: event, detail }),
				);
				surrealProcess = nextProcess;
				await nextProcess.start();
				logger.info("surrealdb.sdk_import.begin");
				const { SurrealGraphStore } = await import("./storage/surreal_store.ts");
				logger.info("surrealdb.sdk_import.ready");
				nextStore = new SurrealGraphStore(
					nextProcess.endpoint,
					"root",
					"root",
					(event, detail) => logger.info("surrealdb.event", { sourceEvent: event, detail }),
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
			logger.info("backend.startup.ready", { storageMode });
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			startupStatus = {
				phase: "failed",
				message: "データを読み込めませんでした。",
				detail,
				logPath,
			};
			logger.error("backend.startup.failed", cause, { storageMode });
			await stopBackend();
			if (storageMigrationRecovery) {
				try {
					const restored = await restoreStorageMigrationBackup(
						storageMigrationRecovery.databasePath,
						storageMigrationRecovery.backupPath,
						storageMigrationRecovery.versionMarkerPath,
					);
					logger.info("storage.migration_backup.restored", { ...restored });
					startupStatus = {
						...startupStatus,
						message: "移行前のデータを復元しました。再試行できます。",
					};
				} catch (restoreCause) {
					logger.error("storage.migration_backup.restore_failed", restoreCause);
					startupStatus = {
						...startupStatus,
						message: "移行に失敗し、バックアップの自動復元にも失敗しました。",
						detail: `${detail}\n復元エラー: ${
							restoreCause instanceof Error ? restoreCause.message : String(restoreCause)
						}`,
					};
				}
			}
		}
		return startupStatus;
	}, { storageMode }).finally(() => {
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

function developmentUiOrigin(value: string | undefined): string | null {
	if (!value) return null;
	const url = new URL(value);
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
		throw new Error("RADIORA_HMR_UI_ORIGIN must be a local HTTP origin.");
	}
	return url.origin;
}

function backendOriginFromServeAddress(address: string): string {
	const prefix = "tcp:127.0.0.1:";
	if (!address.startsWith(prefix)) throw new Error("DENO_SERVE_ADDRESS must use loopback TCP.");
	const port = address.slice(prefix.length);
	if (!/^[1-9]\d{0,4}$/.test(port)) throw new Error("DENO_SERVE_ADDRESS has an invalid port.");
	return `http://127.0.0.1:${port}`;
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
	loadStartupSnapshotCache: () =>
		logger.timed("startup_snapshot.load", () => startupSnapshotCache.load()),
	saveStartupSnapshotCache: async (snapshot, location) => {
		const saved = await logger.timed(
			"startup_snapshot.save",
			() => startupSnapshotCache.save(snapshot, location),
		);
		if (!saved) logger.warn("startup_snapshot.save.skipped", { path: startupSnapshotCachePath });
	},
	rewriteAsNewBranch: (sourceBranchId, newBranchName, confirmation) => {
		const currentStore = store;
		if (!currentStore) {
			throw new Error(
				startupStatus.phase === "failed" ? startupStatus.message : "Radiora is still starting.",
			);
		}
		return new RevisionService(currentStore).rewriteAsNewBranch(
			sourceBranchId,
			newBranchName,
			confirmation,
		);
	},
});
logger.info("desktop.runtime.initialized", { storageMode, surrealPort });

const appWindow = new Deno.BrowserWindow();
let closingWindow = false;
appWindow.addEventListener("close", (event) => {
	if (closingWindow) return;
	event.preventDefault();
	closingWindow = true;
	logger.info("desktop.shutdown.begin");
	void stopBackend().finally(() => {
		logger.info("desktop.shutdown.ready");
		appWindow.close();
	});
});

// In desktop mode Deno.serve owns the runtime loop. Keep it as the final
// operation so window setup, bindings, diagnostics, and bootstrap always run.
const server = Deno.serve(async (request) => {
	const url = new URL(request.url);
	if (url.pathname === "/api/renderer-log" && request.method === "POST") {
		const message = await request.text().catch(() => "<unreadable renderer message>");
		logger.info("renderer.log", { message });
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
			const result = await logger.timed("rpc.request", async () => {
				const body = await request.json() as { args?: unknown[] };
				return handler(...(body.args ?? []));
			}, { method: name });
			return Response.json({ result: result ?? null });
		} catch (cause) {
			return Response.json({ message: cause instanceof Error ? cause.message : String(cause) }, {
				status: 500,
			});
		}
	}
	if (hmrUiOrigin && (request.method === "GET" || request.method === "HEAD")) {
		return Response.redirect(new URL(`${url.pathname}${url.search}`, hmrUiOrigin).href, 307);
	}
	const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
	const safePath = relative.includes("..") ? "index.html" : relative;
	const assetUrl = new URL(safePath, distRoot);
	try {
		const body = await logger.timed(
			"http.asset.read",
			() => Deno.readFile(assetUrl),
			{ method: request.method, path: safePath },
		);
		return new Response(body, {
			headers: { "content-type": mimeTypes[extension(safePath)] ?? "application/octet-stream" },
		});
	} catch {
		if (safePath !== "index.html") return missingAssetResponse(safePath);
		return missingAssetResponse("dist/index.html");
	}
});
await server.finished;
