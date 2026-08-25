import { connect } from "@tursodatabase/database";

const root = await Deno.makeTempDir({ prefix: "radiora-turso-probe-" });
const databasePath = `${root}\\probe.db`;
const backupPath = `${root}\\probe-backup.db`;
let database: Awaited<ReturnType<typeof connect>> | null = null;

try {
	database = await connect(databasePath, { timeout: 5000 });
	await database.exec(`
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
	await database.run("INSERT INTO parent (id) VALUES (?)", "p1");
	await database.run(
		"INSERT INTO child (id, parent_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
		"c1",
		"p1",
		JSON.stringify({ text: "日本語", values: [1, 2] }),
	);
	const row = await database.get("SELECT payload FROM child WHERE id = ?", "c1");
	if (!row || typeof row.payload !== "string" || !JSON.parse(row.payload).text) {
		throw new Error("Turso JSON round-trip probe failed.");
	}

	const rollback = database.transactionAsync(async (transaction) => {
		await transaction.run(
			"INSERT INTO child (id, parent_id, payload) VALUES (?, ?, ?)",
			"rollback",
			"missing",
			"{}",
		);
	});
	try {
		await rollback.immediate();
		throw new Error("Deferred foreign-key rollback probe unexpectedly committed.");
	} catch (cause) {
		if (!(cause instanceof Error)) throw cause;
	}
	const rolledBack = await database.get("SELECT id FROM child WHERE id = ?", "rollback");
	if (rolledBack !== undefined) throw new Error("Transaction rollback probe failed.");

	await database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
	await database.close();
	database = null;
	const reopened = await connect(backupPath, { timeout: 5000 });
	const backupRow = await reopened.get("SELECT id FROM child WHERE id = ?", "c1");
	if (backupRow?.id !== "c1") throw new Error("Turso backup probe failed.");
	await reopened.close();
	console.log(`Turso probe passed: ${databasePath}`);
} finally {
	if (database) await database.close();
	await Deno.remove(root, { recursive: true });
}
