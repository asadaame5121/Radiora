import { assert, assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert@1";
import type { BackupStorePort, GraphStateSnapshot } from "../storage/graph_store.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { BackupRestoreError, type BackupRestoreErrorCode } from "./backup_restore_error.ts";
import { JsonBackupService } from "./json_backup.ts";
import { OutlineService } from "./outline_service.ts";

Deno.test("backup result classifies invalid input without reaching persistence", async () => {
	const sourceStore = new MemoryGraphStore();
	const exported = JSON.parse(await new JsonBackupService(sourceStore).export());
	let writes = 0;
	const service = new JsonBackupService({
		exportGraphState: () => sourceStore.exportGraphState(),
		restoreGraphState: () => {
			writes++;
			return Promise.resolve();
		},
	});
	const cases: [string, BackupRestoreErrorCode, string][] = [
		["{", "invalid-json", "バックアップJSONを解析できません。"],
		["null", "invalid-backup", "バックアップenvelopeが必要です。"],
		["[]", "invalid-backup", "バックアップenvelopeが必要です。"],
		["{}", "invalid-backup", "旧形式のバックアップ構造が不正です。"],
		[
			JSON.stringify({ ...exported, format: "other", schemaVersion: 9 }),
			"invalid-backup",
			"Radioraバックアップ形式ではありません。",
		],
		[
			JSON.stringify({ ...exported, schemaVersion: 0 }),
			"invalid-backup",
			"不正なbackup schema versionです: 0",
		],
		[
			JSON.stringify({ ...exported, schemaVersion: 9 }),
			"unsupported-version",
			"backup schema version 9 はこのアプリより新しいため復元できません。",
		],
		[
			JSON.stringify({ ...exported, data: {} }),
			"invalid-backup",
			"バックアップデータに relationTypeDefinitions が必要です。",
		],
	];
	for (const [source, code, message] of cases) {
		const result = await service.restoreResult(source);
		assert(result.isErr());
		assertEquals(result.error.code, code);
		assertEquals(result.error.message, message);
		assertInstanceOf(result.error, BackupRestoreError);
		if (code === "invalid-json") assertInstanceOf(result.error.cause, SyntaxError);
		if (code === "invalid-backup") assertInstanceOf(result.error.cause, Error);
	}
	assertEquals(writes, 0);
});

Deno.test("backup result retains snapshot validation diagnostics before writes", async () => {
	const store = new MemoryGraphStore();
	const source = JSON.parse(await new JsonBackupService(store).export());
	source.data.works = "not an array";
	const before = await store.exportGraphState();
	const result = await new JsonBackupService(store).restoreResult(JSON.stringify(source));
	assert(result.isErr());
	assertEquals(result.error.code, "invalid-backup");
	assertInstanceOf(result.error.cause, Error);
	assertEquals(result.error.message, result.error.cause.message);
	assertEquals(await store.exportGraphState(), before);
});

for (const synchronous of [true, false]) {
	Deno.test(`backup result captures ${synchronous ? "throw" : "rejection"} and retains cause`, async () => {
		const memory = new MemoryGraphStore();
		const source = await new JsonBackupService(memory).export();
		for (const cause of [new Error("disk full"), "storage unavailable"]) {
			let writes = 0;
			const port: BackupStorePort = {
				exportGraphState: () => memory.exportGraphState(),
				restoreGraphState: () => {
					writes++;
					if (synchronous) throw cause;
					return Promise.reject(cause);
				},
			};
			const service = new JsonBackupService(port);
			const result = await service.restoreResult(source);
			assert(result.isErr());
			assertEquals(result.error.code, "restore-failed");
			assert(result.error.cause === cause);
			assertEquals(result.error.message, cause instanceof Error ? cause.message : cause);
			assertEquals(writes, 1); // No implicit retry.
			const thrown = await assertRejects(() => service.restore(source), BackupRestoreError);
			assertEquals(thrown.code, "restore-failed");
			assert(thrown.cause === cause);
		}
	});
}

Deno.test("backup result resolves only after persistence and reports restored counts", async () => {
	const memory = new MemoryGraphStore();
	await new OutlineService(memory).createItem({ text: "original", parentId: null });
	const service = new JsonBackupService(memory);
	const source = await service.export();
	const expected = await memory.exportGraphState();
	const pending = Promise.withResolvers<void>();
	let written: GraphStateSnapshot | undefined;
	const target = new JsonBackupService({
		exportGraphState: () => memory.exportGraphState(),
		restoreGraphState: (state) => {
			written = state;
			return pending.promise;
		},
	});
	let settled = false;
	const restoring = target.restoreResult(source).map((value) => {
		settled = true;
		return value;
	});
	await Promise.resolve();
	assertEquals(settled, false);
	pending.resolve();
	const result = await restoring;
	assert(result.isOk());
	assertEquals(result.value, {
		workCount: 1,
		occurrenceCount: 1,
		revisionCount: 0,
		recoverySnapshotCount: 0,
	});
	assertEquals(written, expected);
});

Deno.test("OutlineService preserves the RPC rejection and success payload contracts", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const error = await assertRejects(
		() => service.restoreJsonBackup("{"),
		BackupRestoreError,
		"バックアップJSONを解析できません。",
	);
	assertEquals(error.code, "invalid-json");
	assertInstanceOf(error.cause, SyntaxError);
	const result = await service.restoreJsonBackup(await service.exportJsonBackup());
	assertEquals(result, {
		workCount: 0,
		occurrenceCount: 0,
		revisionCount: 0,
		recoverySnapshotCount: 0,
	});
});
