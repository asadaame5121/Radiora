import { assertEquals } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";
import { JsonBackupService, type JsonBackupV6 } from "./json_backup.ts";

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
	const parsed = JSON.parse(source) as JsonBackupV6;
	assertEquals(parsed.format, "radiora-backup");
	assertEquals(parsed.schemaVersion, 6);
	assertEquals(parsed.exportedAt, "2026-07-30T09:00:00.000Z");
	assertEquals(parsed.source, { storageSchemaVersion: 6 });
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
