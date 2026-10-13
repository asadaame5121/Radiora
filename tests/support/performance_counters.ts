import {
	NodeSqliteDatabaseAdapter,
	type SqliteDatabase,
	type SqliteDatabaseTransaction,
} from "../../src/storage/sqlite_records.ts";
import type { SqliteDatabaseConnector } from "../../src/storage/sqlite_store.ts";

export class PerformanceCounters {
	private transactions = 0;
	private sql: string[] = [];

	reset(): void {
		this.transactions = 0;
		this.sql = [];
	}

	snapshot(): { transaction: number } {
		return { transaction: this.transactions };
	}

	getSqlLog(): readonly string[] {
		return this.sql;
	}

	recordTransaction(): void {
		this.transactions++;
	}

	recordSql(sql: string): void {
		this.sql.push(sql);
	}
}

export function createCountingSqliteConnector(
	counters: PerformanceCounters,
): SqliteDatabaseConnector {
	return async (path) => {
		const db = await NodeSqliteDatabaseAdapter.open(path);
		return {
			exec: (sql) => db.exec(sql),
			get: (sql, ...args) => db.get(sql, ...args),
			all: (sql, ...args) => db.all(sql, ...args),
			close: () => db.close(),
			transaction<T>(operation: (txn: SqliteDatabaseTransaction) => T): T {
				counters.recordTransaction();
				return db.transaction((txn) =>
					operation({
						run(sql, ...args) {
							counters.recordSql(sql);
							txn.run(sql, ...args);
						},
					})
				);
			},
		} satisfies SqliteDatabase;
	};
}
