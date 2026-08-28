import { findAvailablePort } from "../desktop/desktop_helpers.ts";
import { SurrealProcess } from "../desktop/surreal_process.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";

export interface LegacySurrealProcessHandle {
	endpoint: string;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface LegacySurrealStoreHandle {
	initialize(): Promise<void>;
	exportGraphState(): Promise<GraphStateSnapshot>;
	close(): Promise<void>;
}

export interface LegacySurrealExporterOptions {
	findPort?: () => Promise<number>;
	createProcess?: (
		path: string,
		host: string,
		port: number,
		onLog: (event: string, detail: unknown) => void,
	) => LegacySurrealProcessHandle;
	createStore?: (endpoint: string) => Promise<LegacySurrealStoreHandle>;
	onLog?: (event: string, fields: Record<string, unknown>, cause?: unknown) => void;
}

async function defaultFindPort(): Promise<number> {
	return findAvailablePort();
}

function defaultCreateProcess(
	path: string,
	host: string,
	port: number,
	onLog: (event: string, detail: unknown) => void,
): LegacySurrealProcessHandle {
	return new SurrealProcess(path, host, port, onLog);
}

async function defaultCreateStore(endpoint: string): Promise<LegacySurrealStoreHandle> {
	const { SurrealGraphStore } = await import("./surreal_store.ts");
	return new SurrealGraphStore(endpoint, "root", "root");
}

/**
 * Starts a transient legacy SurrealDB process on an available loopback port,
 * exports its GraphStateSnapshot, and ensures both store and process are cleaned up.
 */
export async function exportLegacySnapshot(
	copyPath: string,
	options: LegacySurrealExporterOptions = {},
): Promise<GraphStateSnapshot> {
	const findPort = options.findPort ?? defaultFindPort;
	const createProcess = options.createProcess ?? defaultCreateProcess;
	const createStore = options.createStore ?? defaultCreateStore;
	const onLog = options.onLog;

	const port = await findPort();
	const process = createProcess(
		copyPath,
		"127.0.0.1",
		port,
		(event, detail) => onLog?.("surrealdb.migration.event", { sourceEvent: event, detail }),
	);
	let legacyStore: LegacySurrealStoreHandle | null = null;
	try {
		await process.start();
		legacyStore = await createStore(process.endpoint);
		await legacyStore.initialize();
		return await legacyStore.exportGraphState();
	} finally {
		if (legacyStore) {
			try {
				await legacyStore.close();
			} catch (cause) {
				onLog?.("surrealdb.migration_store.close.failed", {}, cause);
			}
		}
		await process.stop();
	}
}
