import { assert, assertEquals } from "jsr:@std/assert@1";
import { BUILT_IN_RELATION_TYPES } from "../src/domain/relation_type.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { createBindingHandlers } from "../src/desktop/register_bindings.ts";
import { OutlineService } from "../src/services/outline_service.ts";
import { APP_VERSION } from "../src/shared/app_version.ts";
import {
	bootstrapStorage,
	type StorageBootstrapSession,
} from "../src/storage/storage_bootstrap.ts";
import { parseSurrealSqlResponse } from "../src/storage/legacy_surreal_migration_reader.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_store.ts";
import { operationLogBindingStub } from "./operation_log_binding_stub.ts";
import {
	T02_CUSTOM_RELATION_TYPE,
	T02_IDS,
	T02_LEGACY_READER_INPUT,
} from "./fixtures/t02_backend_baseline_fixture.ts";

const EDITED_TEXT = "編集後\r\n日本語 🧪\r\ncombining e\u0301";

function createBaselineSnapshot(): GraphStateSnapshot {
	const parsed = parseSurrealSqlResponse(T02_LEGACY_READER_INPUT);
	return validatedGraphStateSnapshot({
		...parsed,
		relationTypeDefinitions: [
			...BUILT_IN_RELATION_TYPES.map((definition) => ({ ...definition })),
			{ ...T02_CUSTOM_RELATION_TYPE },
		],
	});
}

function createFixtureBackup(snapshot: GraphStateSnapshot): string {
	return JSON.stringify({
		format: "radiora-backup",
		schemaVersion: 8,
		exportedAt: "2026-10-01T00:00:00.000Z",
		appVersion: APP_VERSION,
		source: { storageSchemaVersion: 8 },
		data: snapshot,
	});
}

function createRpc(session: StorageBootstrapSession) {
	const service = new OutlineService(session.store);
	return createBindingHandlers({
		...operationLogBindingStub,
		getService: () => service,
		getStartupStatus: () => ({ phase: "ready", message: "準備完了" }),
		retryStartup: () => Promise.resolve({ phase: "ready", message: "準備完了" }),
		rewriteAsNewBranch: () => Promise.reject(new Error("not used by this test")),
	});
}

async function removeTempDir(dir: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			await Deno.remove(dir, { recursive: true });
			return;
		} catch (error) {
			if (attempt === 39) throw error;
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
	}
}

Deno.test("T-02 SQLite service/RPC baseline survives edit, close, and reopen", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-t02-service-reopen-" });
	let session: StorageBootstrapSession | undefined;

	try {
		const baseline = createBaselineSnapshot();
		session = await bootstrapStorage({ dataDir: root, storageMode: "sqlite" });
		const rpc = createRpc(session);

		const restoreResult = await rpc.restoreJsonBackup(createFixtureBackup(baseline));
		assertEquals(restoreResult, {
			workCount: baseline.works.length,
			occurrenceCount: baseline.occurrences.length,
			revisionCount: baseline.revisions.length,
			recoverySnapshotCount: baseline.recoverySnapshots.length,
		});

		const beforeEdit = await rpc.listOutline();
		const beforeItem = beforeEdit.items.find((item) => item.id === T02_IDS.occurrenceA);
		assert(beforeItem);
		assertEquals(beforeItem.text, "日本語\r\nemoji 🧪\r\ncombining e\u0301");

		await rpc.updateItemText(T02_IDS.occurrenceA, EDITED_TEXT);
		const savedState = await session.store.exportGraphState();
		assertEquals(
			savedState.workingCopies.find((copy) => copy.workId === T02_IDS.workA)?.text,
			EDITED_TEXT,
		);

		await session.stop();
		session = undefined;

		session = await bootstrapStorage({ dataDir: root, storageMode: "sqlite" });
		const reopenedRpc = createRpc(session);
		const reopenedState = await session.store.exportGraphState();

		assertEquals(reopenedState, savedState);
		assertEquals(
			(await reopenedRpc.listRelationTypeDefinitions()).find(
				(definition) => definition.name === T02_CUSTOM_RELATION_TYPE.name,
			),
			T02_CUSTOM_RELATION_TYPE,
		);
		const afterReopen = await reopenedRpc.listOutline();
		const afterItem = afterReopen.items.find((item) => item.id === T02_IDS.occurrenceA);
		assert(afterItem);
		assertEquals(afterItem.text, EDITED_TEXT);
		assertEquals(reopenedState.links[0]?.type, T02_CUSTOM_RELATION_TYPE.name);
		assertEquals(reopenedState.occurrences[0]?.parentOccurrenceId, null);
	} finally {
		await session?.stop();
		await removeTempDir(root);
	}
});

Deno.test("T-02 native JSON backup restores equal state into an empty SQLite backend", async () => {
	const sourceRoot = await Deno.makeTempDir({ prefix: "radiora-t02-backup-source-" });
	const targetRoot = await Deno.makeTempDir({ prefix: "radiora-t02-backup-target-" });
	let sourceSession: StorageBootstrapSession | undefined;
	let targetSession: StorageBootstrapSession | undefined;

	try {
		const baseline = createBaselineSnapshot();
		sourceSession = await bootstrapStorage({ dataDir: sourceRoot, storageMode: "sqlite" });
		const sourceRpc = createRpc(sourceSession);
		await sourceRpc.restoreJsonBackup(createFixtureBackup(baseline));
		await sourceRpc.updateItemText(T02_IDS.occurrenceA, EDITED_TEXT);

		const sourceState = await sourceSession.store.exportGraphState();
		const backup = await sourceRpc.exportJsonBackup();
		const backupEnvelope = JSON.parse(backup);
		assertEquals(backupEnvelope.format, "radiora-backup");
		assertEquals(backupEnvelope.schemaVersion, 8);
		assertEquals(backupEnvelope.data, sourceState);

		targetSession = await bootstrapStorage({ dataDir: targetRoot, storageMode: "sqlite" });
		const targetRpc = createRpc(targetSession);
		assertEquals(await targetRpc.listOutline(), {
			items: [],
			links: [],
			knots: [],
			stashItemIds: [],
		});

		const restoreResult = await targetRpc.restoreJsonBackup(backup);
		assertEquals(restoreResult, {
			workCount: sourceState.works.length,
			occurrenceCount: sourceState.occurrences.length,
			revisionCount: sourceState.revisions.length,
			recoverySnapshotCount: sourceState.recoverySnapshots.length,
		});
		assertEquals(await targetSession.store.exportGraphState(), sourceState);

		const restoredBackupEnvelope = JSON.parse(await targetRpc.exportJsonBackup());
		assertEquals(restoredBackupEnvelope.data, sourceState);
	} finally {
		await sourceSession?.stop();
		await targetSession?.stop();
		await removeTempDir(sourceRoot);
		await removeTempDir(targetRoot);
	}
});
