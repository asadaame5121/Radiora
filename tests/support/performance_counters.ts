import {
	NodeSqliteDatabaseAdapter,
	type SqliteDatabase,
	type SqliteDatabaseTransaction,
} from "../../src/storage/sqlite_records.ts";
import type { SqliteDatabaseConnector, SqliteGraphStore } from "../../src/storage/sqlite_store.ts";
import type { MemoryGraphStore } from "../../src/storage/memory_store.ts";

export interface PerformanceCounterSnapshot {
	rpc: number;
	transaction: number;
	sql: number;
	capture: number;
	fullTextParse: number;
	buildVisibleRows: number;
	worldLayout: number;
	lineage: number;
	scc: number;
	lane: number;
	pairCompare: number;
}

export class PerformanceCounters {
	private rpc = 0;
	private transaction = 0;
	private sql = 0;
	private capture = 0;
	private fullTextParse = 0;
	private buildVisibleRows = 0;
	private worldLayout = 0;
	private lineage = 0;
	private scc = 0;
	private lane = 0;
	private pairCompare = 0;

	private readonly sqlLog: string[] = [];

	recordRpc(): void {
		this.rpc += 1;
	}

	recordTransaction(): void {
		this.transaction += 1;
	}

	recordSql(statement?: string): void {
		this.sql += 1;
		if (statement) {
			this.sqlLog.push(statement);
		}
	}

	recordCapture(): void {
		this.capture += 1;
	}

	recordFullTextParse(): void {
		this.fullTextParse += 1;
	}

	recordBuildVisibleRows(): void {
		this.buildVisibleRows += 1;
	}

	recordWorldLayout(): void {
		this.worldLayout += 1;
	}

	recordLineage(): void {
		this.lineage += 1;
	}

	recordScc(): void {
		this.scc += 1;
	}

	recordLane(): void {
		this.lane += 1;
	}

	recordPairCompare(): void {
		this.pairCompare += 1;
	}

	getSqlLog(): readonly string[] {
		return this.sqlLog;
	}

	snapshot(): PerformanceCounterSnapshot {
		return {
			rpc: this.rpc,
			transaction: this.transaction,
			sql: this.sql,
			capture: this.capture,
			fullTextParse: this.fullTextParse,
			buildVisibleRows: this.buildVisibleRows,
			worldLayout: this.worldLayout,
			lineage: this.lineage,
			scc: this.scc,
			lane: this.lane,
			pairCompare: this.pairCompare,
		};
	}

	delta(since: PerformanceCounterSnapshot): PerformanceCounterSnapshot {
		return {
			rpc: this.rpc - since.rpc,
			transaction: this.transaction - since.transaction,
			sql: this.sql - since.sql,
			capture: this.capture - since.capture,
			fullTextParse: this.fullTextParse - since.fullTextParse,
			buildVisibleRows: this.buildVisibleRows - since.buildVisibleRows,
			worldLayout: this.worldLayout - since.worldLayout,
			lineage: this.lineage - since.lineage,
			scc: this.scc - since.scc,
			lane: this.lane - since.lane,
			pairCompare: this.pairCompare - since.pairCompare,
		};
	}

	reset(): void {
		this.rpc = 0;
		this.transaction = 0;
		this.sql = 0;
		this.capture = 0;
		this.fullTextParse = 0;
		this.buildVisibleRows = 0;
		this.worldLayout = 0;
		this.lineage = 0;
		this.scc = 0;
		this.lane = 0;
		this.pairCompare = 0;
		this.sqlLog.length = 0;
	}
}

export function createPerformanceCounters(): PerformanceCounters {
	return new PerformanceCounters();
}

export function createCountingSqliteConnector(
	counters: PerformanceCounters,
	baseConnector?: SqliteDatabaseConnector,
): SqliteDatabaseConnector {
	const connector = baseConnector ?? ((path: string) => NodeSqliteDatabaseAdapter.open(path));

	return async (path: string): Promise<SqliteDatabase> => {
		const db = await connector(path);

		return {
			exec(sql: string): void {
				counters.recordSql(sql);
				db.exec(sql);
			},
			get(sql: string, ...args: unknown[]): unknown {
				counters.recordSql(sql);
				return db.get(sql, ...args);
			},
			all(sql: string, ...args: unknown[]): unknown[] {
				counters.recordSql(sql);
				return db.all(sql, ...args);
			},
			transaction<T>(fn: (txn: SqliteDatabaseTransaction) => T): T {
				counters.recordTransaction();
				return db.transaction((txn) => {
					const wrappedTxn: SqliteDatabaseTransaction = {
						run(sql: string, ...args: unknown[]): void {
							counters.recordSql(sql);
							txn.run(sql, ...args);
						},
					};
					return fn(wrappedTxn);
				});
			},
			close(): void {
				db.close();
			},
		};
	};
}

export function instrumentStore(
	store: MemoryGraphStore,
	counters: PerformanceCounters,
): void {
	const originalExport = store.exportGraphState.bind(store);
	store.exportGraphState = async () => {
		counters.recordCapture();
		return await originalExport();
	};
}
