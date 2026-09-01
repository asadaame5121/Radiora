import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import type { GraphStateSnapshot } from "../storage/graph_store.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";
import { JsonBackupService, type JsonBackupV7 } from "./json_backup.ts";

Deno.test("JSON backup exports every graph entity collection without mutating the store", async () => {
	const store = new MemoryGraphStore();
	const item = await new OccurrenceOperations(store).createItem({
		text: "日本語\n\n**Markdown** [参照](radiora://work/target)",
		parentId: null,
	});
	if (item.revisionSelector.mode !== "branch") throw new Error("expected branch");
	const revisionId = crypto.randomUUID();
	await store.createRevision({
		id: revisionId,
		workId: item.workId,
		text: item.text,
		parentRevisionIds: [],
		kind: "edition",
		createdAt: "2026-07-30T00:00:00.000Z",
	}, item.revisionSelector.branchId);
	await store.createRecoverySnapshot({
		id: crypto.randomUUID(),
		workId: item.workId,
		branchId: item.revisionSelector.branchId,
		text: `${item.text}\n回復`,
		contentHash: "hash",
		createdAt: "2026-07-30T00:01:00.000Z",
		sourceRevisionId: revisionId,
	});
	await store.createBookmark({
		id: crypto.randomUUID(),
		workId: item.workId,
		occurrenceId: item.id,
		createdAt: "2026-07-30T00:02:00.000Z",
	});
	await store.setResumePosition({
		workId: item.workId,
		occurrenceId: item.id,
		caretOffset: 4,
		updatedAt: "2026-07-30T00:03:00.000Z",
	});
	await store.setEmergenceFeedback("legacy-fingerprint", "pin");
	const before = await store.exportGraphState();

	const source = await new JsonBackupService(store).export(
		new Date("2026-07-30T09:00:00.000Z"),
	);
	const parsed = JSON.parse(source) as JsonBackupV7;
	assertEquals(parsed.format, "radiora-backup");
	assertEquals(parsed.schemaVersion, 7);
	assertEquals(parsed.exportedAt, "2026-07-30T09:00:00.000Z");
	assertEquals(parsed.source, { storageSchemaVersion: 7 });
	assertEquals(
		Object.keys(parsed.data).sort(),
		[
			"aliases",
			"bookmarks",
			"branches",
			"emergenceFeedback",
			"emergenceSuggestions",
			"knots",
			"links",
			"occurrences",
			"purgeManifests",
			"recoverySnapshots",
			"relationTypeDefinitions",
			"resumePosition",
			"revisions",
			"savedRuleQueries",
			"systemRelations",
			"workingCopies",
			"works",
		].sort(),
	);
	assertEquals(parsed.data, before);
	assertEquals(await store.exportGraphState(), before);
});

Deno.test("current JSON backup restores only after complete validation", async () => {
	const sourceStore = new MemoryGraphStore();
	await new OccurrenceOperations(sourceStore).createItem({
		text: "復元する\n\n日本語 **Markdown**",
		parentId: null,
	});
	const source = await new JsonBackupService(sourceStore).export(
		new Date("2026-07-30T09:00:00.000Z"),
	);
	const originalInput = source;
	const targetStore = new MemoryGraphStore();
	await new OccurrenceOperations(targetStore).createItem({ text: "置換前", parentId: null });
	const service = new JsonBackupService(targetStore);

	assertEquals(await service.restore(source), {
		workCount: 1,
		occurrenceCount: 1,
		revisionCount: 0,
		recoverySnapshotCount: 0,
	});
	assertEquals(await targetStore.exportGraphState(), await sourceStore.exportGraphState());
	assertEquals(source, originalInput);

	const malformed = JSON.parse(source) as JsonBackupV7;
	malformed.data.branches[0].workId = "missing-work";
	const before = await targetStore.exportGraphState();
	await assertRejects(
		() => service.restore(JSON.stringify(malformed)),
		Error,
		"Invalid Branch",
	);
	assertEquals(await targetStore.exportGraphState(), before);
});

Deno.test("versionless legacy backup migrates in memory without changing its input", async () => {
	const fixtureUrl = new URL("../../tests/fixtures/backup-v0.json", import.meta.url);
	const source = await Deno.readTextFile(fixtureUrl);
	const before = source;
	const store = new MemoryGraphStore();

	const result = await new JsonBackupService(store).restore(source);
	assertEquals(result.workCount, 5);
	const state = await store.exportGraphState();
	assertEquals(state.works.length, 5);
	assertEquals(state.occurrences.length, 5);
	assertEquals(
		state.workingCopies[0].text,
		"原稿\n\n日本語・**Markdown**・radiora://item/22222222-2222-4222-8222-222222222222",
	);
	assertEquals(source, before);
	assertEquals(await Deno.readTextFile(fixtureUrl), before);
});

Deno.test("future backup versions are rejected before any store write", async () => {
	class TrackingStore extends MemoryGraphStore {
		restoreCalls = 0;
		override restoreGraphState(state: GraphStateSnapshot): Promise<void> {
			this.restoreCalls++;
			return super.restoreGraphState(state);
		}
	}
	const store = new TrackingStore();
	await new OccurrenceOperations(store).createItem({ text: "現在のDB", parentId: null });
	const before = await store.exportGraphState();
	const current = JSON.parse(
		await new JsonBackupService(store).export(new Date("2026-07-30T09:00:00.000Z")),
	) as Record<string, unknown>;
	current.schemaVersion = 8;

	await assertRejects(
		() => new JsonBackupService(store).restore(JSON.stringify(current)),
		Error,
		"このアプリより新しい",
	);
	assertEquals(store.restoreCalls, 0);
	assertEquals(await store.exportGraphState(), before);
});

Deno.test("V7 JSON backup restores and round-trips custom relation type definitions", async () => {
	const sourceStore = new MemoryGraphStore();
	const base = await sourceStore.exportGraphState();
	const customDef = {
		name: "CUSTOM_REL",
		direction: "directed" as const,
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	await sourceStore.restoreGraphState({
		...base,
		relationTypeDefinitions: [...(base.relationTypeDefinitions ?? []), customDef],
	});

	const source = await new JsonBackupService(sourceStore).export(
		new Date("2026-09-01T09:00:00.000Z"),
	);

	const targetStore = new MemoryGraphStore();
	const service = new JsonBackupService(targetStore);
	await service.restore(source);

	const targetState = await targetStore.exportGraphState();
	assertEquals(
		targetState.relationTypeDefinitions?.some((def) => def.name === "CUSTOM_REL"),
		true,
	);
});

Deno.test("V7 JSON backup rejects payload missing relationTypeDefinitions before store write", async () => {
	const store = new MemoryGraphStore();
	const validExport = JSON.parse(
		await new JsonBackupService(store).export(new Date("2026-09-01T09:00:00.000Z")),
	) as Record<string, unknown>;

	const dataWithoutCatalog = { ...(validExport.data as Record<string, unknown>) };
	delete dataWithoutCatalog.relationTypeDefinitions;

	const invalidV7 = {
		...validExport,
		data: dataWithoutCatalog,
	};

	await assertRejects(
		() => new JsonBackupService(store).restore(JSON.stringify(invalidV7)),
		Error,
		"relationTypeDefinitions",
	);
});
