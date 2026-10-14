import { AsyncLocalStorage } from "node:async_hooks";
import type { BackupV8, StoredGraphV7 } from "./backup_migrations.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";

export interface JsonRestoreFileOperations {
	writeTextFile(path: string | URL, data: string): Promise<void>;
	rename(oldPath: string | URL, newPath: string | URL): Promise<void>;
	remove(path: string | URL): Promise<void>;
}

interface JsonPersistenceMemory<Savepoint> {
	capture(): Savepoint;
	rollback(state: Savepoint): void;
	exportGraphState(): Promise<GraphStateSnapshot>;
	restoreGraphState(state: GraphStateSnapshot): Promise<void>;
	prepareSnapshot?(): void;
}

const denoRestoreFileOperations: JsonRestoreFileOperations = {
	writeTextFile: (path, data) => Deno.writeTextFile(path, data),
	rename: (oldPath, newPath) => Deno.rename(oldPath, newPath),
	remove: (path) => Deno.remove(path),
};

export type JsonPersistenceContextKind = "ordinary" | "rollback" | "batch" | "restore";

export interface JsonPersistenceContext {
	active: boolean;
	kind: JsonPersistenceContextKind;
}

/** JSON-specific save guarantees; memory/domain operations remain owned by the store. */
export class JsonPersistence<Savepoint = GraphStateSnapshot> {
	private readonly context = new AsyncLocalStorage<JsonPersistenceContext>();
	private mutationQueue: Promise<void> = Promise.resolve();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly path: string | URL,
		private readonly memory: JsonPersistenceMemory<Savepoint>,
		private readonly restoreFiles = denoRestoreFileOperations,
	) {}

	close(): Promise<void> {
		const current = this.context.getStore();
		if (current?.active) {
			return Promise.reject(
				new Error("Cannot close JsonPersistence from inside an active operation"),
			);
		}
		this.closePromise ??= (async () => {
			await this.mutationQueue.catch((cause) => cause);
		})();
		return this.closePromise;
	}

	private async enqueue<T>(task: () => Promise<T>): Promise<T> {
		if (this.closePromise) throw new Error("JsonPersistence is closing");
		const currentQueue = this.mutationQueue;
		const gate = Promise.withResolvers<void>();
		this.mutationQueue = gate.promise;

		await currentQueue.catch((cause) => cause);
		try {
			return await task();
		} finally {
			gate.resolve();
		}
	}

	private async writeDirect(): Promise<void> {
		this.memory.prepareSnapshot?.();
		const data = await this.memory.exportGraphState();
		await Deno.writeTextFile(this.path, serializeBackup(data));
	}

	private activeContext(): JsonPersistenceContext | undefined {
		const current = this.context.getStore();
		if (current && !current.active) throw new Error("JsonPersistence context is expired");
		return current;
	}

	/** Ordinary saves retain mutated memory when a direct write fails. */
	async mutate<T>(operation: () => Promise<T>): Promise<T> {
		const current = this.activeContext();
		if (current) {
			return await operation();
		}
		return await this.enqueue(async () => {
			const ctx: JsonPersistenceContext = { active: true, kind: "ordinary" };
			return await this.context.run(ctx, async () => {
				try {
					const result = await operation();
					await this.writeDirect();
					return result;
				} finally {
					ctx.active = false;
				}
			});
		});
	}

	/** Selected batch/domain operations roll back memory, but still write directly to disk. */
	async mutateWithRollback(operation: () => Promise<void>): Promise<void> {
		const current = this.activeContext();
		if (current) {
			const before = this.memory.capture();
			try {
				await operation();
			} catch (cause) {
				this.memory.rollback(before);
				throw cause;
			}
			return;
		}
		return await this.enqueue(async () => {
			const before = this.memory.capture();
			const ctx: JsonPersistenceContext = { active: true, kind: "rollback" };
			return await this.context.run(ctx, async () => {
				try {
					await operation();
					await this.writeDirect();
				} catch (cause) {
					this.memory.rollback(before);
					throw cause;
				} finally {
					ctx.active = false;
				}
			});
		});
	}

	async persist(): Promise<void> {
		const current = this.context.getStore();
		if (current?.active) {
			return;
		}
		await this.enqueue(() => this.writeDirect());
	}

	async batch<T>(operation: () => Promise<T>): Promise<T> {
		const current = this.activeContext();
		if (current) {
			if (current.kind === "batch") {
				return await operation();
			}
			return Promise.reject(
				new Error("Cannot start batch inside active persistence operation"),
			);
		}
		return await this.enqueue(async () => {
			const before = this.memory.capture();
			const ctx: JsonPersistenceContext = { active: true, kind: "batch" };
			const temporaryPath = this.createTemporaryPath("batch");
			try {
				const result = await this.context.run(ctx, async () => {
					try {
						return await operation();
					} finally {
						ctx.active = false;
					}
				});
				this.memory.prepareSnapshot?.();
				const after = await this.memory.exportGraphState();
				await this.restoreFiles.writeTextFile(temporaryPath, serializeBackup(after));
				await this.restoreFiles.rename(temporaryPath, this.path);
				return result;
			} catch (cause) {
				this.memory.rollback(before);
				await this.cleanupTemporaryFile(temporaryPath);
				throw cause;
			}
		});
	}

	/** Restore alone replaces the file by rename and rolls memory back before cleanup. */
	async restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		const current = this.context.getStore();
		if (current?.active) {
			return Promise.reject(
				new Error("Cannot restoreGraphState from inside an active persistence operation"),
			);
		}
		return await this.enqueue(async () => {
			const ctx: JsonPersistenceContext = { active: true, kind: "restore" };
			return await this.context.run(ctx, async () => {
				try {
					await this.restoreGraphStateDirect(state);
				} finally {
					ctx.active = false;
				}
			});
		});
	}

	private createTemporaryPath(prefix: string): string | URL {
		return typeof this.path === "string"
			? `${this.path}.${prefix}-${crypto.randomUUID()}.tmp`
			: new URL(`${this.path.href}.${prefix}-${crypto.randomUUID()}.tmp`);
	}

	private async restoreGraphStateDirect(state: GraphStateSnapshot): Promise<void> {
		const before = await this.memory.exportGraphState();
		const temporaryPath = this.createTemporaryPath("restore");
		try {
			await this.memory.restoreGraphState(state);
			const data = await this.memory.exportGraphState();
			await this.restoreFiles.writeTextFile(temporaryPath, serializeBackup(data));
			await this.restoreFiles.rename(temporaryPath, this.path);
		} catch (cause) {
			await this.memory.restoreGraphState(before);
			await this.cleanupTemporaryFile(temporaryPath);
			throw cause;
		}
	}

	private async cleanupTemporaryFile(path: string | URL): Promise<void> {
		try {
			await this.restoreFiles.remove(path);
		} catch (_cleanupCause) {
			return;
		}
	}
}

function serializeBackup(data: GraphStateSnapshot): string {
	const backup: BackupV8 = {
		format: "radiora-backup",
		schemaVersion: 8,
		exportedAt: new Date().toISOString(),
		appVersion: "0.1.0",
		source: { storageSchemaVersion: 8 },
		data: data as StoredGraphV7,
	};
	return JSON.stringify(backup, null, 2);
}
