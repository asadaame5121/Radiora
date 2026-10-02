import type { BackupV8, StoredGraphV7 } from "./backup_migrations.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";

export interface JsonRestoreFileOperations {
	writeTextFile(path: string | URL, data: string): Promise<void>;
	rename(oldPath: string | URL, newPath: string | URL): Promise<void>;
	remove(path: string | URL): Promise<void>;
}

interface JsonPersistenceMemory {
	capture(): GraphStateSnapshot;
	rollback(state: GraphStateSnapshot): void;
	exportGraphState(): Promise<GraphStateSnapshot>;
	restoreGraphState(state: GraphStateSnapshot): Promise<void>;
}

const denoRestoreFileOperations: JsonRestoreFileOperations = {
	writeTextFile: (path, data) => Deno.writeTextFile(path, data),
	rename: (oldPath, newPath) => Deno.rename(oldPath, newPath),
	remove: (path) => Deno.remove(path),
};

/** JSON-specific save guarantees; memory/domain operations remain owned by the store. */
export class JsonPersistence {
	constructor(
		private readonly path: string | URL,
		private readonly memory: JsonPersistenceMemory,
		private readonly restoreFiles = denoRestoreFileOperations,
	) {}

	/** Ordinary saves retain mutated memory when a direct write fails. */
	async mutate<T>(operation: () => Promise<T>): Promise<T> {
		const result = await operation();
		await this.persist();
		return result;
	}

	/** Selected batch/domain operations roll back memory, but still write directly to disk. */
	async mutateWithRollback(operation: () => Promise<void>): Promise<void> {
		const before = this.memory.capture();
		try {
			await this.mutate(operation);
		} catch (cause) {
			this.memory.rollback(before);
			throw cause;
		}
	}

	async persist(): Promise<void> {
		const data = await this.memory.exportGraphState();
		// Restore-only injected operations must not change the ordinary save path.
		await Deno.writeTextFile(this.path, serializeBackup(data));
	}

	/** Restore alone replaces the file by rename and rolls memory back before cleanup. */
	async restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		const before = await this.memory.exportGraphState();
		const temporaryPath = typeof this.path === "string"
			? `${this.path}.restore-${crypto.randomUUID()}.tmp`
			: new URL(`${this.path.href}.restore-${crypto.randomUUID()}.tmp`);
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
			// Missing files and failed cleanup both preserve the original restore error.
			// A stale temp file is safe to leave, as in the existing restore contract.
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
