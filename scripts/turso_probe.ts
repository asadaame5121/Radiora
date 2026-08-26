import { DatabaseSync } from "node:sqlite";

const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-probe-" });
const databasePath = `${root}\\probe.db`;
const backupPath = `${root}\\probe-backup.db`;
let database: DatabaseSync | null = null;

try {
	database = new DatabaseSync(databasePath, { open: true });
	database.exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
		CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT;
		CREATE TABLE child (
			id TEXT PRIMARY KEY,
			parent_id TEXT NOT NULL,
			payload TEXT NOT NULL CHECK (json_valid(payload)),
			FOREIGN KEY (parent_id) REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED
		) STRICT;
	`);
	database.prepare("INSERT INTO parent (id) VALUES (?)").run("p1");
	database
		.prepare(
			"INSERT INTO child (id, parent_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
		)
		.run("c1", "p1", JSON.stringify({ text: "日本語", values: [1, 2] }));
	const row = database.prepare("SELECT payload FROM child WHERE id = ?").get("c1") as
		| { payload: string }
		| undefined;
	if (!row || typeof row.payload !== "string" || !JSON.parse(row.payload).text) {
		throw new Error("SQLite JSON round-trip probe failed.");
	}

	try {
		database.exec("BEGIN IMMEDIATE");
		database
			.prepare("INSERT INTO child (id, parent_id, payload) VALUES (?, ?, ?)")
			.run("rollback", "missing", "{}");
		database.exec("COMMIT");
		throw new Error("Deferred foreign-key rollback probe unexpectedly committed.");
	} catch (cause) {
		if (cause instanceof Error && cause.message.includes("unexpectedly committed")) {
			throw cause;
		}
		try {
			database.exec("ROLLBACK");
		} catch (rollbackError) {
			throw new Error(
				`Probe rollback failed after ${cause instanceof Error ? cause.message : String(cause)}: ${
					rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
				}`,
				{ cause: rollbackError },
			);
		}
	}
	const rolledBack = database.prepare("SELECT id FROM child WHERE id = ?").get("rollback");
	if (rolledBack !== undefined) throw new Error("Transaction rollback probe failed.");

	database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
	database.close();
	database = null;
	const reopened = new DatabaseSync(backupPath, { open: true });
	const backupRow = reopened.prepare("SELECT id FROM child WHERE id = ?").get("c1") as
		| { id: string }
		| undefined;
	if (backupRow?.id !== "c1") throw new Error("SQLite backup probe failed.");
	reopened.close();
	console.log(`SQLite probe passed: ${databasePath}`);
} finally {
	if (database) database.close();
	await Deno.remove(root, { recursive: true });
}
