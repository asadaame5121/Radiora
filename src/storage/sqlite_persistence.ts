import { AsyncLocalStorage } from "node:async_hooks";
import type { GraphStateSnapshot } from "./graph_store.ts";
import {
	applySqliteDiffOperations,
	persistSqliteDiff,
	type SqliteDatabase,
} from "./sqlite_records.ts";
import type { TargetedMutationStep } from "./sqlite_targeted_mutations.ts";

interface SqlitePersistenceMemory {
	exportGraphState(): Promise<GraphStateSnapshot>;
	restoreGraphState(state: GraphStateSnapshot): Promise<void>;
	prepareSnapshot(): void;
	clearPendingProjection(): void;
}

/** Owns SQLite mutation ordering, transaction boundaries, and memory recovery. */
export class SqlitePersistence {
	private mutationQueue: Promise<void> = Promise.resolve();
	private closePromise: Promise<void> | null = null;
	private readonly batchContext = new AsyncLocalStorage<{ active: boolean }>();

	constructor(
		private readonly database: () => SqliteDatabase,
		private readonly memory: SqlitePersistenceMemory,
	) {}

	inBatch(): boolean {
		const context = this.batchContext.getStore();
		if (context && !context.active) throw new Error("Batch context is expired");
		return context !== undefined;
	}

	close(closeDatabase: () => void): Promise<void> {
		if (this.batchContext.getStore()?.active) {
			return Promise.reject(new Error("Cannot close SqliteGraphStore from inside an active batch"));
		}
		this.closePromise ??= (async () => {
			await this.mutationQueue;
			closeDatabase();
		})();
		return this.closePromise;
	}

	async enqueue<T>(task: () => Promise<T>): Promise<T> {
		this.database();
		if (this.closePromise) throw new Error("SqliteGraphStore is closing");
		const currentQueue = this.mutationQueue;
		const gate = Promise.withResolvers<void>();
		this.mutationQueue = gate.promise;
		await currentQueue;
		try {
			this.database();
			return await task();
		} finally {
			gate.resolve();
		}
	}

	async mutateTargeted<T>(plan: () => TargetedMutationStep<T>): Promise<T> {
		if (this.inBatch()) return await plan().execute();
		return await this.enqueue(async () => {
			const step = plan();
			if (step.affectsOutlineStructure) return await this.commitFullMutation(step.execute);
			try {
				const result = await step.execute();
				applySqliteDiffOperations(step.diff, this.database());
				return result;
			} catch (cause) {
				step.rollback();
				throw cause;
			}
		});
	}

	async commitFullMutation<T>(operation: () => Promise<T>): Promise<T> {
		const before = await this.memory.exportGraphState();
		try {
			const result = await operation();
			this.memory.prepareSnapshot();
			const after = await this.memory.exportGraphState();
			persistSqliteDiff(before, after, this.database());
			return result;
		} catch (cause) {
			this.memory.clearPendingProjection();
			await this.memory.restoreGraphState(before);
			throw cause;
		} finally {
			this.memory.clearPendingProjection();
		}
	}

	async mutate<T>(operation: () => Promise<T>): Promise<T> {
		if (this.inBatch()) return await operation();
		return await this.enqueue(() => this.commitFullMutation(operation));
	}

	async batch<T>(operation: () => Promise<T>): Promise<T> {
		if (this.inBatch()) return await operation();
		return await this.mutate(async () => {
			const context = { active: true };
			return await this.batchContext.run(context, async () => {
				try {
					return await operation();
				} finally {
					context.active = false;
				}
			});
		});
	}
}
