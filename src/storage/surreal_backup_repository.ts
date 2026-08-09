import type { BackupStorePort, GraphStateSnapshot, GraphStore } from "./graph_store.ts";
import {
	buildSurrealRestoreTransaction,
	exportSurrealGraphState,
} from "./surreal_backup_restore.ts";
import { validatedGraphStateSnapshot } from "./graph_store.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";

export class SurrealBackupRepository implements BackupStorePort {
	constructor(
		private readonly db: SurrealQueryClient,
		private readonly store: () => GraphStore,
	) {}

	exportGraphState(): Promise<GraphStateSnapshot> {
		return exportSurrealGraphState(this.store(), this.db);
	}

	async restoreGraphState(source: GraphStateSnapshot): Promise<void> {
		const state = validatedGraphStateSnapshot(source);
		const transaction = buildSurrealRestoreTransaction(state);
		await this.db.query(transaction.query, transaction.variables);
	}
}
