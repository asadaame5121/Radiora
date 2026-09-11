import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { HistoricalTimeSchema } from "../src/domain/historical_time.ts";
import { parse } from "valibot";
import { OutlineService } from "../src/services/outline_service.ts";
import { JsonBackupService } from "../src/services/json_backup.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import { JsonGraphStore } from "../src/storage/json_store.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import { NodeSqliteDatabaseAdapter } from "../src/storage/sqlite_records.ts";
import { historicalTimeMigration } from "../src/storage/migrations/0007_historical_time.ts";
import { workFromRow } from "../src/storage/surreal_row_mapper.ts";
import { buildSurrealRestoreTransaction } from "../src/storage/surreal_backup_restore.ts";

const time = parse(HistoricalTimeSchema, {
	kind: "period",
	start: { precision: "year", year: 1604 },
	end: { precision: "year", year: 1867 },
	original: "江戸時代",
});

for (const kind of ["memory", "json", "sqlite"] as const) {
	Deno.test(`historical time ${kind}: shared placements, deletion, backup and reopen`, async () => {
		const dir = await Deno.makeTempDir();
		const path = `${dir}/store.${kind === "sqlite" ? "db" : "json"}`;
		const create = () =>
			kind === "memory"
				? new MemoryGraphStore()
				: kind === "json"
				? new JsonGraphStore(path)
				: new SqliteGraphStore(path);
		let store = create();
		try {
			await store.initialize();
			const service = new OutlineService(store);
			const item = await service.createItem({ text: "江戸時代", parentId: null });
			await service.createOccurrence({ workId: item.workId, parentId: null });
			await service.setWorkHistoricalTime(item.workId, time);
			assertEquals((await service.listOutline()).items.map((item) => item.historicalTime), [
				time,
				time,
			]);
			const backup = await new JsonBackupService(store).export();
			const restored = new MemoryGraphStore();
			await new JsonBackupService(restored).restore(backup);
			assertEquals((await restored.listWorks())[0].historicalTime, time);
			const transaction = buildSurrealRestoreTransaction(await store.exportGraphState());
			assert(
				Object.values(transaction.variables).some((value) =>
					typeof value === "object" && value !== null && "historical_time" in value
				),
			);
			await assertRejects(() =>
				service.setWorkHistoricalTime(item.workId, { kind: "bad" } as never)
			);
			assertEquals((await store.listWorks())[0].historicalTime, time);
			if (kind !== "memory") {
				await store.close();
				store = create();
				await store.initialize();
				assertEquals((await store.listWorks())[0].historicalTime, time);
			}
			await new OutlineService(store).setWorkHistoricalTime(item.workId, null);
			assert((await store.listItems()).every((item) => item.historicalTime === undefined));
		} finally {
			await store.close();
			await Deno.remove(dir, { recursive: true });
		}
	});
}

Deno.test("historical time migrations protect legacy JSON and SQLite state", async () => {
	const dir = await Deno.makeTempDir();
	try {
		const memory = new MemoryGraphStore();
		await new OutlineService(memory).createItem({ text: "旧データ", parentId: null });
		const old = JSON.parse(await new JsonBackupService(memory).export());
		old.schemaVersion = 7;
		const path = `${dir}/old.json`;
		await Deno.writeTextFile(path, JSON.stringify(old));
		const json = new JsonGraphStore(path);
		await json.initialize();
		assertEquals(JSON.parse(await Deno.readTextFile(path)).schemaVersion, 8);
		assertEquals((await json.listWorks())[0].historicalTime, undefined);
		const dbPath = `${dir}/old.db`;
		const sqlite = new SqliteGraphStore(dbPath);
		await sqlite.initialize();
		await sqlite.restoreGraphState(await memory.exportGraphState());
		await sqlite.close();
		const db = await NodeSqliteDatabaseAdapter.open(dbPath);
		db.exec("UPDATE storage_metadata SET schema_version = 1;");
		db.close();
		const migrated = new SqliteGraphStore(dbPath);
		await migrated.initialize();
		assertEquals((await migrated.listWorks())[0].historicalTime, undefined);
		assertEquals(JSON.parse(await Deno.readTextFile(`${dbPath}.before-v2.json`)).schemaVersion, 7);
		await migrated.close();
	} finally {
		await Deno.remove(dir, { recursive: true });
	}
});

Deno.test("Surreal historical metadata is validated and migration preserves optionality", async () => {
	const statements: string[] = [];
	const context = {
		execute: (sql: string) => {
			statements.push(sql);
			return Promise.resolve();
		},
	};
	await historicalTimeMigration.up(context);
	await historicalTimeMigration.validate(context);
	assert(statements[0].includes("FLEXIBLE TYPE option<object>"));
	const work = workFromRow({
		id: crypto.randomUUID(),
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		historical_time: time,
	});
	assertEquals(work.historicalTime, time);
});
