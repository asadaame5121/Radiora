import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Branch, Occurrence, Revision, Work, WorkingCopy } from "../../src/domain/models.ts";
import type { GraphStore } from "../../src/storage/graph_store.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";
const UPDATED_AT = "2026-07-28T00:01:00.000Z";
const DELETED_AT = "2026-07-28T00:02:00.000Z";

export async function assertGraphStoreContract(store: GraphStore): Promise<void> {
	const root = bundle("contract root");
	const target = bundle("contract target");
	const dependent = bundle("contract dependent");
	dependent.occurrence.parentOccurrenceId = root.occurrence.id;
	const mirror: Occurrence = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		parentOccurrenceId: target.occurrence.id,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: root.branch.id },
		contextualHeading: "mirror",
	};

	await store.createWorkBundle(root.work, root.branch, root.copy, root.occurrence);
	await store.createWorkBundle(target.work, target.branch, target.copy, target.occurrence);
	await store.createWorkBundle(
		dependent.work,
		dependent.branch,
		dependent.copy,
		dependent.occurrence,
	);
	await store.createOccurrence(mirror);
	await store.updateWorkingCopy(root.work.id, "contract root updated", UPDATED_AT);
	await store.updateOccurrence({ ...mirror, collapsed: true, contextualHeading: "mirror updated" });

	const firstRevision: Revision = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		text: "first edition",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: CREATED_AT,
	};
	const secondRevision: Revision = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		text: "second edition",
		parentRevisionIds: [firstRevision.id],
		kind: "edition",
		createdAt: UPDATED_AT,
	};
	const mergeRevision: Revision = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		text: "merged immutable text",
		parentRevisionIds: [firstRevision.id, secondRevision.id],
		kind: "merge",
		createdAt: UPDATED_AT,
		message: "two parents",
	};
	await store.createRevision(firstRevision, root.branch.id);
	await store.createRevision(secondRevision, root.branch.id);
	await store.createRevision(mergeRevision, root.branch.id);
	mergeRevision.text = "caller mutation must not alter storage";
	mergeRevision.parentRevisionIds.length = 0;
	const storedMerge = (await store.listRevisions(root.work.id))
		.find((revision) => revision.id === mergeRevision.id);
	assertEquals(storedMerge?.text, "merged immutable text");
	assertEquals(storedMerge?.parentRevisionIds, [firstRevision.id, secondRevision.id]);
	assertEquals(
		(await store.listBranches(root.work.id)).find((branch) => branch.id === root.branch.id)
			?.headRevisionId,
		mergeRevision.id,
	);

	const targetRevision: Revision = {
		id: crypto.randomUUID(),
		workId: target.work.id,
		text: "other work",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: CREATED_AT,
	};
	await store.createRevision(targetRevision, target.branch.id);
	const rejectedRevisions: Revision[] = [
		{
			id: crypto.randomUUID(),
			workId: root.work.id,
			text: "missing parent",
			parentRevisionIds: [crypto.randomUUID()],
			kind: "edition",
			createdAt: UPDATED_AT,
		},
		{
			id: crypto.randomUUID(),
			workId: root.work.id,
			text: "cross-work parent",
			parentRevisionIds: [targetRevision.id],
			kind: "edition",
			createdAt: UPDATED_AT,
		},
		{
			id: crypto.randomUUID(),
			workId: root.work.id,
			text: "duplicate parent",
			parentRevisionIds: [firstRevision.id, firstRevision.id],
			kind: "merge",
			createdAt: UPDATED_AT,
		},
	];
	const selfParentRevision: Revision = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		text: "self parent",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: UPDATED_AT,
	};
	selfParentRevision.parentRevisionIds = [selfParentRevision.id];
	rejectedRevisions.push(selfParentRevision);

	for (const rejected of rejectedRevisions) {
		await assertRejects(() => store.createRevision(rejected, root.branch.id));
		assertEquals(
			(await store.listRevisions()).some((revision) => revision.id === rejected.id),
			false,
		);
		assertEquals(
			(await store.listBranches(root.work.id)).find((branch) => branch.id === root.branch.id)
				?.headRevisionId,
			mergeRevision.id,
		);
	}

	const alternateBranch: Branch = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		name: "alternate",
		headRevisionId: firstRevision.id,
		createdAt: UPDATED_AT,
	};
	await store.createBranch(alternateBranch, {
		branchId: alternateBranch.id,
		workId: root.work.id,
		text: "alternate draft",
		updatedAt: UPDATED_AT,
	});
	await store.updateBranch({ ...alternateBranch, promotedAt: UPDATED_AT });
	assertEquals(
		(await store.listBranches(root.work.id)).find((branch) => branch.id === alternateBranch.id)
			?.promotedAt,
		UPDATED_AT,
	);
	const alternateOccurrence: Occurrence = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		parentOccurrenceId: null,
		orderKey: 4096,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: alternateBranch.id },
	};
	const pinnedOccurrence: Occurrence = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		parentOccurrenceId: null,
		orderKey: 5120,
		collapsed: false,
		revisionSelector: { mode: "pinned", revisionId: mergeRevision.id },
	};
	await store.createOccurrence(alternateOccurrence);
	await store.createOccurrence(pinnedOccurrence);
	await store.updateBranchWorkingCopy(
		alternateBranch.id,
		"alternate independently updated",
		UPDATED_AT,
	);
	await store.updateWorkingCopy(root.work.id, "contract root compatibility updated", UPDATED_AT);
	const projected = await store.listItems();
	assertEquals(
		projected.find((item) => item.id === root.occurrence.id)?.text,
		"contract root compatibility updated",
	);
	assertEquals(
		projected.find((item) => item.id === alternateOccurrence.id)?.text,
		"alternate independently updated",
	);
	assertEquals(
		projected.find((item) => item.id === pinnedOccurrence.id)?.text,
		"merged immutable text",
	);

	const revisionCount = (await store.listRevisions(root.work.id)).length;
	const snapshotId = crypto.randomUUID();
	await store.createRecoverySnapshot({
		id: snapshotId,
		workId: root.work.id,
		branchId: alternateBranch.id,
		text: "snapshot draft",
		contentHash: "sha256:contract",
		createdAt: UPDATED_AT,
		sourceRevisionId: firstRevision.id,
		name: "before rewrite",
		protection: {
			reason: "revision-source",
			protectedAt: UPDATED_AT,
		},
	});
	assertEquals((await store.listRevisions(root.work.id)).length, revisionCount);
	assertEquals(
		(await store.listRecoverySnapshots(root.work.id, alternateBranch.id))[0].sourceRevisionId,
		firstRevision.id,
	);
	await store.applyRecoverySnapshot(snapshotId, DELETED_AT);
	assertEquals(
		(await store.listItems()).find((item) => item.id === alternateOccurrence.id)?.text,
		"snapshot draft",
	);
	await store.updateBranchWorkingCopy(
		alternateBranch.id,
		"draft immediately before restore",
		UPDATED_AT,
	);
	const beforeRestoreId = crypto.randomUUID();
	await store.restoreRecoverySnapshot(snapshotId, {
		id: beforeRestoreId,
		workId: root.work.id,
		branchId: alternateBranch.id,
		text: "draft immediately before restore",
		contentHash: "sha256:before-restore",
		createdAt: DELETED_AT,
		sourceRevisionId: firstRevision.id,
		name: "before restore",
	}, DELETED_AT);
	assertEquals(
		(await store.listRecoverySnapshots(root.work.id, alternateBranch.id))
			.find((snapshot) => snapshot.id === beforeRestoreId)?.text,
		"draft immediately before restore",
	);
	assertEquals(
		(await store.listWorkingCopies(root.work.id))
			.find((copy) => copy.branchId === alternateBranch.id)?.text,
		"snapshot draft",
	);
	assertEquals(
		(await store.listBranches(root.work.id))
			.find((branch) => branch.id === alternateBranch.id)?.headRevisionId,
		firstRevision.id,
	);
	assertEquals((await store.listRevisions(root.work.id)).length, revisionCount);

	const promotedRevision: Revision = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		text: "snapshot draft",
		parentRevisionIds: [firstRevision.id],
		kind: "edition",
		createdAt: DELETED_AT,
	};
	await store.promoteRecoverySnapshot(
		snapshotId,
		promotedRevision,
		alternateBranch.id,
		DELETED_AT,
	);
	assertEquals(
		(await store.listBranches(root.work.id))
			.find((branch) => branch.id === alternateBranch.id)?.headRevisionId,
		promotedRevision.id,
	);
	assertEquals((await store.listRevisions(root.work.id)).length, revisionCount + 1);
	assertEquals(
		(await store.listRecoverySnapshots(root.work.id, alternateBranch.id))
			.find((snapshot) => snapshot.id === snapshotId)?.protection,
		{ reason: "revision-source", protectedAt: DELETED_AT },
	);
	const stateBeforeRejectedRestore = {
		snapshots: await store.listRecoverySnapshots(root.work.id, alternateBranch.id),
		copies: await store.listWorkingCopies(root.work.id),
		revisions: await store.listRevisions(root.work.id),
		branches: await store.listBranches(root.work.id),
	};
	await assertRejects(() =>
		store.restoreRecoverySnapshot(snapshotId, {
			id: crypto.randomUUID(),
			workId: root.work.id,
			branchId: alternateBranch.id,
			text: "not the current Working Copy",
			contentHash: "sha256:invalid",
			createdAt: DELETED_AT,
			sourceRevisionId: promotedRevision.id,
		}, DELETED_AT)
	);
	assertEquals(
		await store.listRecoverySnapshots(root.work.id, alternateBranch.id),
		stateBeforeRejectedRestore.snapshots,
	);
	assertEquals(await store.listWorkingCopies(root.work.id), stateBeforeRejectedRestore.copies);
	assertEquals(await store.listRevisions(root.work.id), stateBeforeRejectedRestore.revisions);
	assertEquals(await store.listBranches(root.work.id), stateBeforeRejectedRestore.branches);

	const rootItems = (await store.listItems()).filter((item) => item.workId === root.work.id);
	assertEquals(rootItems.length, 4);
	assertEquals(
		rootItems.find((item) => item.id === root.occurrence.id)?.text,
		"contract root compatibility updated",
	);
	assertEquals(
		rootItems.find((item) => item.id === mirror.id)?.text,
		"contract root compatibility updated",
	);
	assertEquals(rootItems.find((item) => item.id === mirror.id)?.parentId, target.occurrence.id);
	assertEquals(rootItems.find((item) => item.id === mirror.id)?.collapsed, true);
	assertEquals(
		rootItems.find((item) => item.id === mirror.id)?.contextualHeading,
		"mirror updated",
	);

	const linkId = crypto.randomUUID();
	await store.createLink({
		id: linkId,
		fromId: root.work.id,
		toId: target.work.id,
		from: { scope: "work", workId: root.work.id },
		to: { scope: "work", workId: target.work.id },
		type: "SUPPORT",
		status: "asserted",
		origin: "human",
		reason: "contract",
		createdAt: CREATED_AT,
	});
	const link = (await store.listLinks()).find((candidate) => candidate.id === linkId);
	assertEquals(link?.from.workId, root.work.id);
	assertEquals(link?.to.workId, target.work.id);
	assertEquals(link?.reason, "contract");

	const aliasId = crypto.randomUUID();
	await store.upsertAlias({
		id: aliasId,
		canonical: "contract",
		variants: ["agreement"],
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
	});
	assertEquals(
		(await store.listAliases()).find((alias) => alias.id === aliasId)?.variants,
		["agreement"],
	);
	await store.setEmergenceFeedback(aliasId, "pin");
	assertEquals(await store.getEmergenceFeedback(aliasId), "pin");

	const queryId = crypto.randomUUID();
	await store.upsertSavedRuleQuery({
		id: queryId,
		name: "Contract query",
		source: '?- link("SUPPORT", From, To).',
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
	});
	assertEquals(
		(await store.listSavedRuleQueries()).find((query) => query.id === queryId)?.name,
		"Contract query",
	);

	assert(
		(await store.suggestItems("contract root", 8)).some((item) => item.workId === root.work.id),
	);
	assert((await store.searchLexical("updated", 8)).some((hit) => hit.item.workId === root.work.id));
	const bookmarkId = crypto.randomUUID();
	const targetBookmarkId = crypto.randomUUID();
	await store.createBookmark({
		id: bookmarkId,
		workId: root.work.id,
		occurrenceId: root.occurrence.id,
		createdAt: CREATED_AT,
	});
	await store.createBookmark({
		id: targetBookmarkId,
		workId: target.work.id,
		occurrenceId: target.occurrence.id,
		createdAt: CREATED_AT,
	});
	await store.setResumePosition({
		workId: root.work.id,
		occurrenceId: root.occurrence.id,
		caretOffset: 10_000,
		updatedAt: UPDATED_AT,
	});
	assertEquals((await store.listBookmarks())[0]?.id, bookmarkId);
	assertEquals((await store.getResumePosition())?.caretOffset, 10_000);
	const bookmarksBeforeInvalidWrite = await store.listBookmarks();
	await assertRejects(
		() =>
			store.createBookmark({
				id: crypto.randomUUID(),
				workId: root.work.id,
				occurrenceId: target.occurrence.id,
				createdAt: CREATED_AT,
			}),
		Error,
		"must exist and match",
	);
	assertEquals(await store.listBookmarks(), bookmarksBeforeInvalidWrite);
	await assertRejects(
		() =>
			store.setResumePosition({
				workId: root.work.id,
				occurrenceId: root.occurrence.id,
				caretOffset: -1,
				updatedAt: UPDATED_AT,
			}),
		Error,
		"Invalid caret offset",
	);
	assertEquals((await store.getResumePosition())?.caretOffset, 10_000);
	await assertRejects(
		() =>
			store.setResumePosition({
				workId: root.work.id,
				occurrenceId: target.occurrence.id,
				caretOffset: 1,
				updatedAt: UPDATED_AT,
			}),
		Error,
		"must exist and match",
	);
	assertEquals((await store.getResumePosition())?.occurrenceId, root.occurrence.id);
	await assertRejects(
		() => store.purgeWork(root.work.id),
		Error,
		"Work must be in trash before it can be purged",
	);

	await store.trashWork(root.work.id, DELETED_AT);
	assertEquals((await store.listWorks()).some((work) => work.id === root.work.id), false);
	assertEquals((await store.listItems()).some((item) => item.workId === root.work.id), false);
	assertEquals(
		(await store.listWorks(true)).find((work) => work.id === root.work.id)?.deletedAt,
		DELETED_AT,
	);
	assertEquals(
		(await store.listOccurrences(true)).filter((occurrence) => occurrence.workId === root.work.id)
			.length,
		4,
	);
	assertEquals((await store.listBookmarks()).map((bookmark) => bookmark.id), [targetBookmarkId]);
	assertEquals(await store.getResumePosition(), null);

	await store.restoreWork(root.work.id);
	assertEquals((await store.listBookmarks())[0]?.id, bookmarkId);
	assertEquals((await store.getResumePosition())?.caretOffset, 10_000);
	assertEquals(
		(await store.listItems()).filter((item) => item.workId === root.work.id).length,
		4,
	);
	await store.deleteOccurrence(mirror.id);
	assertEquals(
		(await store.listOccurrences()).filter((occurrence) => occurrence.workId === root.work.id)
			.length,
		3,
	);

	await store.trashWork(root.work.id, DELETED_AT);
	const manifest = await store.purgeWork(root.work.id);
	assertEquals(manifest.workId, root.work.id);
	assert(manifest.occurrenceIds.includes(root.occurrence.id));
	assert(manifest.linkIds.includes(linkId));
	assert(manifest.revisionIds.includes(firstRevision.id));
	assert(manifest.revisionIds.includes(secondRevision.id));
	assert(manifest.revisionIds.includes(mergeRevision.id));
	assertEquals((await store.listRecoverySnapshots(root.work.id)).length, 0);
	assertEquals((await store.listBookmarks()).some((bookmark) => bookmark.id === bookmarkId), false);
	assert((await store.listBookmarks()).some((bookmark) => bookmark.id === targetBookmarkId));
	assertEquals(await store.getResumePosition(), null);
	assertEquals((await store.listWorks(true)).some((work) => work.id === root.work.id), false);
	assertEquals((await store.listLinks()).some((candidate) => candidate.id === linkId), false);
	assert((await store.listPurgeManifests()).some((candidate) => candidate.id === manifest.id));
	assert((await store.listWorks()).some((work) => work.id === target.work.id));
	assertEquals(
		(await store.listItems()).find((item) => item.id === dependent.occurrence.id)?.parentId,
		null,
	);

	await store.deleteAlias(aliasId);
	await store.deleteSavedRuleQuery(queryId);
	assertEquals((await store.listAliases()).some((alias) => alias.id === aliasId), false);
	assertEquals((await store.listSavedRuleQueries()).some((query) => query.id === queryId), false);
	await store.setResumePosition({
		workId: target.work.id,
		occurrenceId: target.occurrence.id,
		caretOffset: 1,
		updatedAt: UPDATED_AT,
	});
	const dependentBookmarkId = crypto.randomUUID();
	await store.createBookmark({
		id: dependentBookmarkId,
		workId: dependent.work.id,
		occurrenceId: dependent.occurrence.id,
		createdAt: CREATED_AT,
	});
	await store.trashWork(target.work.id, DELETED_AT);
	await store.purgeWork(target.work.id);
	assertEquals(await store.getResumePosition(), null);
	assert((await store.listBookmarks()).some((bookmark) => bookmark.id === dependentBookmarkId));
	await store.trashWork(dependent.work.id, DELETED_AT);
	await store.purgeWork(dependent.work.id);
}

function bundle(text: string): {
	work: Work;
	branch: Branch;
	copy: WorkingCopy;
	occurrence: Occurrence;
} {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	return {
		work: {
			id: workId,
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
		},
		branch: {
			id: branchId,
			workId,
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		copy: {
			branchId,
			workId,
			text,
			updatedAt: CREATED_AT,
		},
		occurrence: {
			id: crypto.randomUUID(),
			workId,
			parentOccurrenceId: null,
			orderKey: 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		},
	};
}
