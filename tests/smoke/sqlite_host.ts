/**
 * Test-only loopback host for Issue #329's full-stack smoke tests.
 *
 * Composes the real desktop seam — SQLite bootstrap, services, binding handlers, and the
 * shared HTTP RPC boundary — and serves a built asset directory on `http://127.0.0.1`.
 * The desktop entry is never imported, so no `Deno.BrowserWindow`, CEF, autoUpdate, HMR
 * bridge, or user-data fallback runs here.
 *
 * Usage:
 *   deno run -A tests/smoke/sqlite_host.ts --data-dir <abs path> --token <nonce> \
 *     [--port <0-65535>] [--dist-dir <path>]
 *
 * Readiness is one stdout JSON line: {"event":"test_host.ready","origin":...,"pid":...}.
 * Shutdown: write "shutdown\n" to stdin, or close stdin (EOF). In-flight requests drain,
 * storage closes, and the process exits 0.
 * Exit codes: 0 normal, 1 startup/serve failure, 2 argument or guard failure.
 *
 * Covered: HTTP RPC protocol, SQLite persistence, operation/diagnostic logging, guarded
 * static delivery. Not covered: the desktop shell, updater, HMR, rendering, and the
 * startup snapshot cache — this host intentionally omits both cache ports, so a browser
 * reload can only be satisfied by persisted storage.
 */
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assetMimeType, missingAssetResponse } from "../../src/desktop/desktop_helpers.ts";
import { createBindingHandlers } from "../../src/desktop/register_bindings.ts";
import { createRpcHttpHandler, RPC_PATH_PREFIX } from "../../src/desktop/rpc_http.ts";
import { Logger, selectLogRecord } from "../../src/services/logger.ts";
import { createDiagnosticLogSink, OperationLog } from "../../src/services/operation_log.ts";
import { OutlineService } from "../../src/services/outline_service.ts";
import { RevisionService } from "../../src/services/revision_service.ts";
import type { StartupStatus } from "../../src/shared/bindings.ts";
import type { GraphStore, RelationTypeDefinitionStorePort } from "../../src/storage/graph_store.ts";
import {
	bootstrapStorage,
	type StorageBootstrapSession,
} from "../../src/storage/storage_bootstrap.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOOPBACK_HOST = "127.0.0.1";
const DATA_MARKER_NAME = ".radiora-smoke-host.json";
const MARKER_ROLE = "radiora-smoke-data";
const READY_EVENT = "test_host.ready";
const RENDERER_LOG_PATH = "/api/renderer-log";
const RENDERER_LOG_MESSAGES = ["Svelte entry module started", "Svelte app mounted"];
const INDEX_FILE = "index.html";
const STORAGE_MODE = "sqlite";
const MIN_PORT = 0;
const MAX_PORT = 65_535;
const MIN_TOKEN_LENGTH = 16;

/** Argument or guard failure: reported with usage and exit code 2. */
class HostGuardError extends Error {}

interface HostOptions {
	readonly dataDir: string;
	readonly token: string;
	readonly port: number;
	readonly distDir: string;
}

interface HostRuntime {
	readonly logger: Logger;
	readonly rpcHttp: (request: Request) => Promise<Response>;
	readonly bootstrap: () => Promise<StartupStatus>;
	readonly stop: () => Promise<void>;
}

function usage(): string {
	return "usage: deno run -A tests/smoke/sqlite_host.ts --data-dir <abs path> --token <nonce> " +
		"[--port <0-65535>] [--dist-dir <path>]";
}

function parsePort(value: string): number {
	if (!/^\d+$/.test(value)) throw new HostGuardError(`Invalid --port: ${value}`);
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
		throw new HostGuardError(`Invalid --port: ${value}`);
	}
	return port;
}

function parseOptionPairs(args: readonly string[]): Map<string, string> {
	const known = new Set(["--data-dir", "--token", "--port", "--dist-dir"]);
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (key === undefined || !key.startsWith("--")) {
			throw new HostGuardError(`Unexpected argument: ${key ?? ""}`);
		}
		if (value === undefined || value.startsWith("--")) {
			throw new HostGuardError(`Missing value for ${key}`);
		}
		if (!known.has(key)) throw new HostGuardError(`Unknown option: ${key}`);
		if (values.has(key)) throw new HostGuardError(`Duplicate option: ${key}`);
		values.set(key, value);
	}
	return values;
}

function parseHostArgs(args: readonly string[]): HostOptions {
	const values = parseOptionPairs(args);
	const dataDir = values.get("--data-dir");
	const token = values.get("--token");
	if (!dataDir) throw new HostGuardError("--data-dir is required");
	if (!/^[A-Za-z]:[\\/]/.test(dataDir)) {
		throw new HostGuardError(`--data-dir must be an absolute Windows path: ${dataDir}`);
	}
	if (!token || token.length < MIN_TOKEN_LENGTH) {
		throw new HostGuardError(`--token must be a nonce of at least ${MIN_TOKEN_LENGTH} characters`);
	}
	return {
		dataDir,
		token,
		port: parsePort(values.get("--port") ?? "0"),
		distDir: values.get("--dist-dir") ?? "dist",
	};
}

function assertWindowsHost(): void {
	if (Deno.build.os !== "windows") {
		throw new HostGuardError(
			"The smoke host runs on Windows only: the data directory layout uses backslash segments.",
		);
	}
}

/** Resolves a directory argument (absolute or repo-relative) to a slash-terminated file URL. */
function directoryUrl(path: string, repoRoot: string): URL {
	const absolute = isAbsolute(path) ? path : resolve(repoRoot, path);
	return pathToFileURL(absolute.endsWith(sep) ? absolute : `${absolute}${sep}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the ownership marker; a missing or unreadable marker means "not ours yet". */
async function readDataMarker(path: string): Promise<string | null> {
	let text: string;
	try {
		text = await Deno.readTextFile(path);
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return null;
		throw cause;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.role !== MARKER_ROLE || typeof value.token !== "string") {
		return null;
	}
	return value.token;
}

/**
 * Refuses any data directory a previous test host did not create: the marker nonce must match,
 * and a directory without the marker must be empty. User data directories never pass this guard.
 */
async function requireOwnedDataDir(dataDir: string, token: string): Promise<void> {
	const stat = await Deno.stat(dataDir).catch((cause) => {
		if (cause instanceof Deno.errors.NotFound) return null;
		throw cause;
	});
	if (!stat?.isDirectory) {
		throw new HostGuardError(`--data-dir must be an existing directory: ${dataDir}`);
	}
	const markerPath = `${dataDir}\\${DATA_MARKER_NAME}`;
	const markerToken = await readDataMarker(markerPath);
	if (markerToken !== null) {
		if (markerToken !== token) {
			throw new HostGuardError(
				`Refusing ${dataDir}: ${DATA_MARKER_NAME} was created by another test host (token mismatch).`,
			);
		}
		return;
	}
	const entries: string[] = [];
	for await (const entry of Deno.readDir(dataDir)) entries.push(entry.name);
	if (entries.length > 0) {
		throw new HostGuardError(
			`Refusing non-empty --data-dir without ${DATA_MARKER_NAME}: ${dataDir}`,
		);
	}
	await Deno.writeTextFile(
		markerPath,
		`${
			JSON.stringify({ role: MARKER_ROLE, token, createdAt: new Date().toISOString() }, null, "\t")
		}\n`,
	);
}

function createRuntime(options: HostOptions): HostRuntime {
	const logDir = `${options.dataDir}\\logs`;
	const logPath = `${logDir}\\startup.log`;
	const operationLog = new OperationLog(logDir);
	const logger = new Logger({
		selectRecord: (entry) => selectLogRecord("development", entry),
		sink: createDiagnosticLogSink(logDir),
		stdout: (line) => console.log(line),
	});
	let startupStatus: StartupStatus = {
		phase: "starting",
		message: "Radioraを起動しています…",
		logPath,
	};
	let session: StorageBootstrapSession | null = null;
	let service: OutlineService | null = null;
	let store: (GraphStore & RelationTypeDefinitionStorePort) | null = null;
	let bootstrapPromise: Promise<StartupStatus> | null = null;
	let lastView = "";

	async function stop(): Promise<void> {
		service = null;
		store = null;
		const activeSession = session;
		session = null;
		if (activeSession) await activeSession.stop();
	}

	async function bootstrap(): Promise<StartupStatus> {
		if (bootstrapPromise) return bootstrapPromise;
		bootstrapPromise = logger.timed("test_host.bootstrap", async () => {
			startupStatus = { phase: "starting", message: "データを読み込んでいます…", logPath };
			logger.info("test_host.storage.begin", {
				storageMode: STORAGE_MODE,
				dataDir: options.dataDir,
			});
			await stop();
			try {
				const activeSession = await bootstrapStorage({
					dataDir: options.dataDir,
					storageMode: STORAGE_MODE,
					logger,
				});
				session = activeSession;
				store = activeSession.store;
				service = new OutlineService(activeSession.store);
				startupStatus = { phase: "ready", message: "準備完了", logPath };
				logger.info("test_host.storage.ready", { storageMode: STORAGE_MODE });
			} catch (cause) {
				startupStatus = {
					phase: "failed",
					message: "データを読み込めませんでした。",
					detail: cause instanceof Error ? cause.message : String(cause),
					logPath,
				};
				logger.error("test_host.storage.failed", cause, { storageMode: STORAGE_MODE });
				await stop();
			}
			return startupStatus;
		}, { storageMode: STORAGE_MODE }).finally(() => {
			bootstrapPromise = null;
		});
		return bootstrapPromise;
	}

	const handlers = createBindingHandlers({
		getOperationSummary: async () => operationLog.summary(),
		exportOperationLog: async () => operationLog.exportJsonl(),
		clearDiagnosticLogs: async () => operationLog.clearAll(),
		recordViewChange: async (view) => {
			if (typeof view !== "string" || view.length === 0) throw new Error("Invalid view.");
			if (view === lastView) return;
			lastView = view;
			operationLog.record(`view.${view}`, "ok");
		},
		recordClientOperation: async (event, outcome, durationMs) => {
			if (event !== "search.execute" && event !== "export.markdown") {
				throw new Error("Invalid operation.");
			}
			if (outcome !== "ok" && outcome !== "error") throw new Error("Invalid outcome.");
			if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error("Invalid duration.");
			operationLog.record(event, outcome, durationMs);
		},
		getService: () => service,
		getStartupStatus: () => startupStatus,
		retryStartup: bootstrap,
		// The startup snapshot cache ports stay omitted on purpose; see the module header.
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

	const rpcHttp = createRpcHttpHandler({
		handlers: { ...handlers },
		recordOperation: ({ method, outcome, durationMs, errorName }) => {
			// Test-host policy: every attempt is logged under its own event namespace. Production's
			// method catalogue and release filtering stay in `src/main.ts`.
			try {
				operationLog.record(`test_host.rpc.${method}`, outcome, durationMs, errorName);
			} catch (cause) {
				logger.error("operation_log.write.failed", cause);
			}
		},
		measureRequest: (method, invoke) => logger.timed("rpc.request", invoke, { method }),
		onStartupStatusPoll: () => {
			if (startupStatus.phase === "starting" && !bootstrapPromise) void bootstrap();
		},
	});

	return { logger, rpcHttp, bootstrap, stop };
}

async function assetResponse(request: Request, url: URL, distRoot: URL): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return Response.json({ message: "Method not allowed." }, { status: 405 });
	}
	const requested = url.pathname === "/" ? INDEX_FILE : url.pathname.slice(1);
	const safePath = requested.includes("..") ? INDEX_FILE : requested;
	const assetUrl = new URL(safePath, distRoot);
	if (!assetUrl.href.startsWith(distRoot.href)) return missingAssetResponse(safePath);
	try {
		const body = await Deno.readFile(assetUrl);
		const headers = { "content-type": assetMimeType(safePath) };
		return request.method === "HEAD"
			? new Response(null, { headers })
			: new Response(body, { headers });
	} catch {
		if (safePath !== INDEX_FILE) return missingAssetResponse(safePath);
		return missingAssetResponse("dist/index.html");
	}
}

function startServer(runtime: HostRuntime, options: HostOptions): Deno.HttpServer {
	const distRoot = directoryUrl(options.distDir, REPO_ROOT);
	try {
		return Deno.serve({ hostname: LOOPBACK_HOST, port: options.port }, async (request) => {
			const url = new URL(request.url);
			if (url.pathname === RENDERER_LOG_PATH && request.method === "POST") {
				const message = await request.text().catch(() => "");
				if (RENDERER_LOG_MESSAGES.includes(message)) {
					runtime.logger.info("renderer.log", { message });
				}
				return new Response(null, { status: 204 });
			}
			if (url.pathname.startsWith(RPC_PATH_PREFIX)) return await runtime.rpcHttp(request);
			return await assetResponse(request, url, distRoot);
		});
	} catch (cause) {
		throw new Error(
			`could not listen on ${LOOPBACK_HOST}:${options.port}: ${
				cause instanceof Error ? cause.message : String(cause)
			}`,
			{ cause },
		);
	}
}

function reportReady(server: Deno.HttpServer, options: HostOptions): void {
	const address = server.addr;
	if (address.transport !== "tcp") throw new Error("Expected a TCP listener.");
	console.log(JSON.stringify({
		event: READY_EVENT,
		origin: `http://${LOOPBACK_HOST}:${address.port}`,
		port: address.port,
		pid: Deno.pid,
		dataDir: options.dataDir,
		sqlite: `${options.dataDir}\\turso\\radiora.db`,
		logDir: `${options.dataDir}\\logs`,
	}));
}

async function waitForShutdownLine(): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of Deno.stdin.readable) {
		buffer += decoder.decode(chunk, { stream: true });
		let index = buffer.indexOf("\n");
		while (index >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			if (line === "shutdown") return;
			index = buffer.indexOf("\n");
		}
	}
	// stdin ended: treat EOF as a shutdown request so a crashed controller leaves no orphan.
}

async function shutdown(server: Deno.HttpServer, runtime: HostRuntime): Promise<void> {
	runtime.logger.info("test_host.shutdown.begin");
	try {
		await server.shutdown();
	} finally {
		await runtime.stop();
	}
	runtime.logger.info("test_host.shutdown.ready");
}

async function run(): Promise<number> {
	const options = parseHostArgs(Deno.args);
	assertWindowsHost();
	await requireOwnedDataDir(options.dataDir, options.token);
	const runtime = createRuntime(options);
	const server = startServer(runtime, options);
	try {
		const status = await runtime.bootstrap();
		if (status.phase !== "ready") {
			console.error(JSON.stringify({
				event: "test_host.startup.failed",
				detail: status.phase === "failed" ? status.detail : undefined,
				logPath: status.logPath,
			}));
			return 1;
		}
		reportReady(server, options);
		await waitForShutdownLine();
		return 0;
	} finally {
		await shutdown(server, runtime);
	}
}

if (import.meta.main) {
	try {
		Deno.exit(await run());
	} catch (cause) {
		console.error(`test host failed: ${cause instanceof Error ? cause.message : String(cause)}`);
		if (cause instanceof HostGuardError) console.error(usage());
		Deno.exit(cause instanceof HostGuardError ? 2 : 1);
	}
}
