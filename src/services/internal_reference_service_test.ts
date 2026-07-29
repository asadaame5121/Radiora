import { assertEquals } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { InternalReferenceService } from "./internal_reference_service.ts";

const NOW = "2026-01-02T03:04:05.000Z";

async function createWork(
	store: MemoryGraphStore,
	input: { workId: string; branchId: string; occurrenceId: string; text: string },
): Promise<void> {
	await store.createWorkBundle(
		{ id: input.workId, createdAt: NOW, updatedAt: NOW },
		{
			id: input.branchId,
			workId: input.workId,
			name: "main",
			headRevisionId: null,
			createdAt: NOW,
		},
		{ branchId: input.branchId, workId: input.workId, text: input.text, updatedAt: NOW },
		{
			id: input.occurrenceId,
			workId: input.workId,
			parentOccurrenceId: null,
			orderKey: 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: input.branchId },
		},
	);
}

Deno.test("internal references resolve Work and immutable Revision IDs after display text changes", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, {
		workId: "work-target",
		branchId: "branch-target",
		occurrenceId: "occ-target",
		text: "旧名",
	});
	await store.createRevision({
		id: "revision-fixed",
		workId: "work-target",
		text: "固定版",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: NOW,
	}, "branch-target");
	await store.updateWorkingCopy("work-target", "改名後", "2026-01-02T04:00:00.000Z");
	const service = new InternalReferenceService(store);

	const resolutions = await service.resolve(
		"[旧名](radiora://work/work-target) [初稿](radiora://revision/revision-fixed)",
	);
	assertEquals(
		resolutions.map((resolution) => ({
			status: resolution.status,
			displayName: resolution.displayName,
			workId: resolution.workId,
			revisionId: resolution.revision?.id,
		})),
		[
			{
				status: "resolved",
				displayName: "改名後",
				workId: "work-target",
				revisionId: undefined,
			},
			{
				status: "resolved",
				displayName: "固定版",
				workId: "work-target",
				revisionId: "revision-fixed",
			},
		],
	);
	assertEquals(resolutions[1].revision?.text, "固定版");
});

Deno.test("resolver distinguishes scope mismatch, deleted, and missing references", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, {
		workId: "work-deleted",
		branchId: "branch-deleted",
		occurrenceId: "occ-deleted",
		text: "削除対象",
	});
	await store.createRevision({
		id: "revision-known",
		workId: "work-deleted",
		text: "既知の版",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: NOW,
	}, "branch-deleted");
	await store.trashWork("work-deleted", NOW);
	const service = new InternalReferenceService(store);

	const resolutions = await service.resolve([
		"[deleted](radiora://work/work-deleted)",
		"[wrong](radiora://work/revision-known)",
		"[wrong](radiora://revision/work-deleted)",
		"[missing](radiora://revision/unknown)",
	].join(" "));
	assertEquals(resolutions.map((resolution) => resolution.status), [
		"deleted",
		"scope-mismatch",
		"scope-mismatch",
		"missing",
	]);
	assertEquals(resolutions.every((resolution) => !resolution.navigationTarget), true);
});

Deno.test("completion lists active Work and Revision with canonical ID-bearing Markdown", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, {
		workId: "work-123456789",
		branchId: "branch-active",
		occurrenceId: "occ-active",
		text: "表示 [名]",
	});
	await store.createRevision({
		id: "revision-abcdefghi",
		workId: "work-123456789",
		text: "初稿",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: NOW,
	}, "branch-active");
	const candidates = await new InternalReferenceService(store).listCompletions();

	assertEquals(
		candidates.map((candidate) => ({
			scope: candidate.scope,
			displayName: candidate.displayName,
			scopeLabel: candidate.scopeLabel,
			shortId: candidate.shortId,
			canonicalMarkdown: candidate.canonicalMarkdown,
		})),
		[
			{
				scope: "revision",
				displayName: "初稿",
				scopeLabel: "固定版",
				shortId: "revision",
				canonicalMarkdown: "[初稿](radiora://revision/revision-abcdefghi)",
			},
			{
				scope: "work",
				displayName: "表示 [名]",
				scopeLabel: "項目",
				shortId: "work-123",
				canonicalMarkdown: "[表示 \\[名\\]](radiora://work/work-123456789)",
			},
		],
	);
});

Deno.test("backlinks scan current Working Copies and fixed Revisions without persistent relations", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, {
		workId: "work-target",
		branchId: "branch-target",
		occurrenceId: "occ-target",
		text: "対象",
	});
	await createWork(store, {
		workId: "work-source",
		branchId: "branch-source",
		occurrenceId: "occ-source",
		text: "現在 [対象](radiora://work/work-target)",
	});
	await store.createRevision({
		id: "revision-source",
		workId: "work-source",
		text: "固定 [対象](radiora://work/work-target) と [対象](radiora://work/work-target)",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: NOW,
	}, "branch-source");
	const service = new InternalReferenceService(store);

	const beforeLinks = await store.listLinks();
	const beforeSystemRelations = await store.listSystemRelations();
	const backlinks = await service.listBacklinks("work", "work-target");
	assertEquals(
		backlinks.map((backlink) => ({
			source: backlink.source,
			count: backlink.count,
		})),
		[
			{
				source: { scope: "work", workId: "work-source", branchId: "branch-source" },
				count: 1,
			},
			{
				source: {
					scope: "revision",
					workId: "work-source",
					revisionId: "revision-source",
				},
				count: 2,
			},
		],
	);
	assertEquals(await store.listLinks(), beforeLinks);
	assertEquals(await store.listSystemRelations(), beforeSystemRelations);
});
