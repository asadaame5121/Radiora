import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type {
	Branch,
	EmergenceSuggestion,
	Occurrence,
	Revision,
	StubCreationKind,
	Work,
	WorkingCopy,
} from "../../src/domain/models.ts";
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
	const storedMerge = (await store.listRevisions(root.work.id)).find(
		(revision) => revision.id === mergeRevision.id,
	);
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
	await store.restoreRecoverySnapshot(
		snapshotId,
		{
			id: beforeRestoreId,
			workId: root.work.id,
			branchId: alternateBranch.id,
			text: "draft immediately before restore",
			contentHash: "sha256:before-restore",
			createdAt: DELETED_AT,
			sourceRevisionId: firstRevision.id,
			name: "before restore",
		},
		DELETED_AT,
	);
	assertEquals(
		(await store.listRecoverySnapshots(root.work.id, alternateBranch.id)).find(
			(snapshot) => snapshot.id === beforeRestoreId,
		)?.text,
		"draft immediately before restore",
	);
	assertEquals(
		(await store.listWorkingCopies(root.work.id)).find(
			(copy) => copy.branchId === alternateBranch.id,
		)?.text,
		"snapshot draft",
	);
	assertEquals(
		(await store.listBranches(root.work.id)).find((branch) => branch.id === alternateBranch.id)
			?.headRevisionId,
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
	await store.promoteRecoverySnapshot(snapshotId, promotedRevision, alternateBranch.id, DELETED_AT);
	assertEquals(
		(await store.listBranches(root.work.id)).find((branch) => branch.id === alternateBranch.id)
			?.headRevisionId,
		promotedRevision.id,
	);
	assertEquals((await store.listRevisions(root.work.id)).length, revisionCount + 1);
	assertEquals(
		(await store.listRecoverySnapshots(root.work.id, alternateBranch.id)).find(
			(snapshot) => snapshot.id === snapshotId,
		)?.protection,
		{ reason: "revision-source", protectedAt: DELETED_AT },
	);
	const stateBeforeRejectedRestore = {
		snapshots: await store.listRecoverySnapshots(root.work.id, alternateBranch.id),
		copies: await store.listWorkingCopies(root.work.id),
		revisions: await store.listRevisions(root.work.id),
		branches: await store.listBranches(root.work.id),
	};
	await assertRejects(() =>
		store.restoreRecoverySnapshot(
			snapshotId,
			{
				id: crypto.randomUUID(),
				workId: root.work.id,
				branchId: alternateBranch.id,
				text: "not the current Working Copy",
				contentHash: "sha256:invalid",
				createdAt: DELETED_AT,
				sourceRevisionId: promotedRevision.id,
			},
			DELETED_AT,
		),
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

	// A valid Stub permits an empty Working Copy; a plain Work still requires text.
	const stubbed = blankUnplaced({
		createdAt: CREATED_AT,
		createdVia: "stub-list",
		context: "contract stub",
	});
	await store.createUnplacedWork(stubbed.work, stubbed.branch, stubbed.copy);
	assertEquals((await store.listWorks()).find((work) => work.id === stubbed.work.id)?.stub, {
		createdAt: CREATED_AT,
		createdVia: "stub-list",
		context: "contract stub",
	});

	const plainBlank = blankUnplaced();
	await assertRejects(
		() => store.createUnplacedWork(plainBlank.work, plainBlank.branch, plainBlank.copy),
		Error,
		"must not be blank",
	);
	const unknownKind = blankUnplaced({
		createdAt: CREATED_AT,
		createdVia: "import" as StubCreationKind,
	});
	await assertRejects(
		() => store.createUnplacedWork(unknownKind.work, unknownKind.branch, unknownKind.copy),
		Error,
		"must not be blank",
	);
	const invalidInstant = blankUnplaced({ createdAt: "not-a-date", createdVia: "stub-list" });
	await assertRejects(
		() => store.createUnplacedWork(invalidInstant.work, invalidInstant.branch, invalidInstant.copy),
		Error,
		"must not be blank",
	);

	// Resolving a Stub removes the marker, records the instant, and is not repeatable.
	await store.resolveWorkStub(stubbed.work.id, UPDATED_AT);
	const resolvedStub = (await store.listWorks()).find((work) => work.id === stubbed.work.id);
	assertEquals(resolvedStub?.stub, undefined);
	assertEquals(Object.hasOwn(resolvedStub ?? {}, "stub"), false);
	assertEquals(resolvedStub?.updatedAt, UPDATED_AT);
	await assertRejects(
		() => store.resolveWorkStub(stubbed.work.id, UPDATED_AT),
		Error,
		"not a Stub",
	);

	const aliasId = crypto.randomUUID();
	await store.upsertAlias({
		id: aliasId,
		canonical: "contract",
		variants: ["agreement"],
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
	});
	assertEquals((await store.listAliases()).find((alias) => alias.id === aliasId)?.variants, [
		"agreement",
	]);
	await store.setEmergenceFeedback(aliasId, "pin");
	assertEquals(await store.getEmergenceFeedback(aliasId), "pin");

	const emergenceId = `emergence-${crypto.randomUUID()}`;
	const emergence: EmergenceSuggestion = {
		id: emergenceId,
		kind: "latent-relation",
		contextWorkId: root.work.id,
		targetWorkId: target.work.id,
		contextItemId: root.occurrence.id,
		targetItemId: target.occurrence.id,
		proposedLinkType: "LIKE",
		title: "Persistent candidate",
		explanation: "shared contract evidence",
		evidence: [
			{
				fromId: root.occurrence.id,
				toId: target.occurrence.id,
				relation: "LEXICAL",
			},
		],
		score: 0.75,
		persistenceStatus: "pending",
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
	};
	await store.upsertEmergenceSuggestion(emergence);
	await store.resolveEmergenceSuggestion(emergenceId, "pin");
	assertEquals((await store.listEmergenceSuggestions())[0].persistenceStatus, "held");
	const suggestionLink = {
		id: crypto.randomUUID(),
		fromId: root.work.id,
		toId: target.work.id,
		from: { scope: "work" as const, workId: root.work.id },
		to: { scope: "work" as const, workId: target.work.id },
		type: "LIKE" as const,
		status: "asserted" as const,
		origin: "suggestion" as const,
		createdAt: UPDATED_AT,
	};
	await store.resolveEmergenceSuggestion(emergenceId, "accept", suggestionLink);
	await store.resolveEmergenceSuggestion(emergenceId, "accept", suggestionLink);
	assertEquals((await store.listEmergenceSuggestions())[0].persistenceStatus, "accepted");
	assertEquals((await store.listLinks()).filter((link) => link.origin === "suggestion").length, 1);

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
	assert((await store.listBookmarks()).some((bookmark) => bookmark.id === bookmarkId));
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
	assertEquals(
		(await store.listWorks()).some((work) => work.id === root.work.id),
		false,
	);
	assertEquals(
		(await store.listItems()).some((item) => item.workId === root.work.id),
		false,
	);
	assertEquals(
		(await store.listWorks(true)).find((work) => work.id === root.work.id)?.deletedAt,
		DELETED_AT,
	);
	assertEquals(
		(await store.listOccurrences(true)).filter((occurrence) => occurrence.workId === root.work.id)
			.length,
		4,
	);
	assertEquals(
		(await store.listBookmarks()).map((bookmark) => bookmark.id),
		[targetBookmarkId],
	);
	assertEquals(await store.getResumePosition(), null);

	await store.restoreWork(root.work.id);
	assert((await store.listBookmarks()).some((bookmark) => bookmark.id === bookmarkId));
	assertEquals((await store.getResumePosition())?.caretOffset, 10_000);
	assertEquals((await store.listItems()).filter((item) => item.workId === root.work.id).length, 4);
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
	assertEquals(
		(await store.listBookmarks()).some((bookmark) => bookmark.id === bookmarkId),
		false,
	);
	assert((await store.listBookmarks()).some((bookmark) => bookmark.id === targetBookmarkId));
	assertEquals(await store.getResumePosition(), null);
	assertEquals(
		(await store.listWorks(true)).some((work) => work.id === root.work.id),
		false,
	);
	assertEquals(
		(await store.listLinks()).some((candidate) => candidate.id === linkId),
		false,
	);
	assert((await store.listPurgeManifests()).some((candidate) => candidate.id === manifest.id));
	assert((await store.listWorks()).some((work) => work.id === target.work.id));
	assertEquals(
		(await store.listItems()).find((item) => item.id === dependent.occurrence.id)?.parentId,
		null,
	);

	await store.deleteAlias(aliasId);
	await store.deleteSavedRuleQuery(queryId);
	assertEquals(
		(await store.listAliases()).some((alias) => alias.id === aliasId),
		false,
	);
	assertEquals(
		(await store.listSavedRuleQueries()).some((query) => query.id === queryId),
		false,
	);
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

	await assertPointReadContract(store);
}

async function assertPointReadContract(store: GraphStore): Promise<void> {
	// 1. 通常ノード (normal node)
	const normal = bundle("point-read normal text");
	await store.createWorkBundle(normal.work, normal.branch, normal.copy, normal.occurrence);

	const itemNormal = await store.getItem(normal.occurrence.id);
	const listNormalItem = (await store.listItems()).find((i) => i.id === normal.occurrence.id);
	assertEquals(itemNormal, listNormalItem);
	assertEquals(itemNormal?.text, "point-read normal text");

	const occNormal = await store.getOccurrence(normal.occurrence.id);
	const listNormalOcc = (await store.listOccurrences()).find((o) => o.id === normal.occurrence.id);
	assertEquals(occNormal, listNormalOcc);

	// 2. 別branchノード (alternate branch)
	const altBranch: Branch = {
		id: crypto.randomUUID(),
		workId: normal.work.id,
		name: "alt-feature",
		headRevisionId: null,
		createdAt: CREATED_AT,
	};
	const altCopy: WorkingCopy = {
		branchId: altBranch.id,
		workId: normal.work.id,
		text: "alt branch text",
		updatedAt: UPDATED_AT,
	};
	const altOccurrence: Occurrence = {
		id: crypto.randomUUID(),
		workId: normal.work.id,
		parentOccurrenceId: normal.occurrence.id,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: altBranch.id },
	};
	await store.createBranch(altBranch, altCopy);
	await store.createOccurrence(altOccurrence);

	const itemAlt = await store.getItem(altOccurrence.id);
	const listAltItem = (await store.listItems()).find((i) => i.id === altOccurrence.id);
	assertEquals(itemAlt, listAltItem);
	assertEquals(itemAlt?.text, "alt branch text");

	// 3. pinnedノード (pinned revision)
	const pinnedRev: Revision = {
		id: crypto.randomUUID(),
		workId: normal.work.id,
		text: "pinned revision text",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: CREATED_AT,
	};
	const pinnedOcc: Occurrence = {
		id: crypto.randomUUID(),
		workId: normal.work.id,
		parentOccurrenceId: normal.occurrence.id,
		orderKey: 2048,
		collapsed: true,
		revisionSelector: { mode: "pinned", revisionId: pinnedRev.id },
		contextualHeading: "Pinned Heading",
	};
	await store.createRevision(pinnedRev, normal.branch.id);
	await store.createOccurrence(pinnedOcc);

	const itemPinned = await store.getItem(pinnedOcc.id);
	const listPinnedItem = (await store.listItems()).find((i) => i.id === pinnedOcc.id);
	assertEquals(itemPinned, listPinnedItem);
	assertEquals(itemPinned?.text, "pinned revision text");
	assertEquals(itemPinned?.contextualHeading, "Pinned Heading");

	// 4. Stubノード (work with stub)
	const stubWork: Work = {
		id: crypto.randomUUID(),
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
		stub: {
			createdVia: "stub-list",
			createdAt: CREATED_AT,
		},
	};
	const stubBranch: Branch = {
		id: crypto.randomUUID(),
		workId: stubWork.id,
		name: "main",
		headRevisionId: null,
		createdAt: CREATED_AT,
	};
	const stubCopy: WorkingCopy = {
		branchId: stubBranch.id,
		workId: stubWork.id,
		text: "stub text",
		updatedAt: CREATED_AT,
	};
	const stubOcc: Occurrence = {
		id: crypto.randomUUID(),
		workId: stubWork.id,
		parentOccurrenceId: null,
		orderKey: 4096,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: stubBranch.id },
	};
	await store.createWorkBundle(stubWork, stubBranch, stubCopy, stubOcc);

	const itemStub = await store.getItem(stubOcc.id);
	const listStubItem = (await store.listItems()).find((i) => i.id === stubOcc.id);
	assertEquals(itemStub, listStubItem);

	const occStub = await store.getOccurrence(stubOcc.id);
	const listStubOcc = (await store.listOccurrences()).find((o) => o.id === stubOcc.id);
	assertEquals(occStub, listStubOcc);

	// 5. 削除Work (trashWork)
	const trashBundle = bundle("to be trashed");
	await store.createWorkBundle(
		trashBundle.work,
		trashBundle.branch,
		trashBundle.copy,
		trashBundle.occurrence,
	);
	await store.trashWork(trashBundle.work.id, DELETED_AT);

	assertEquals(await store.getItem(trashBundle.occurrence.id), null);
	assertEquals(await store.getOccurrence(trashBundle.occurrence.id), null);
	assertEquals(
		(await store.listItems()).find((i) => i.id === trashBundle.occurrence.id),
		undefined,
	);
	assertEquals(
		(await store.listOccurrences(false)).find((o) => o.id === trashBundle.occurrence.id),
		undefined,
	);

	// 6. merged Work
	const survivorBundle = bundle("survivor text");
	const sourceBundle = bundle("source text");
	await store.createWorkBundle(
		survivorBundle.work,
		survivorBundle.branch,
		survivorBundle.copy,
		survivorBundle.occurrence,
	);
	await store.createWorkBundle(
		sourceBundle.work,
		sourceBundle.branch,
		sourceBundle.copy,
		sourceBundle.occurrence,
	);
	await store.mergeWorks({
		sourceWorkId: sourceBundle.work.id,
		survivorWorkId: survivorBundle.work.id,
		mergedAt: UPDATED_AT,
	});

	// mergeWorks後はsourceのoccurrenceはsurvivorにrewireされている
	const rewiredItem = await store.getItem(sourceBundle.occurrence.id);
	const listRewiredItem = (await store.listItems()).find(
		(i) => i.id === sourceBundle.occurrence.id,
	);
	assertEquals(rewiredItem, listRewiredItem);
	assertEquals(rewiredItem?.workId, survivorBundle.work.id);

	const rewiredOcc = await store.getOccurrence(sourceBundle.occurrence.id);
	const listRewiredOcc = (await store.listOccurrences()).find(
		(o) => o.id === sourceBundle.occurrence.id,
	);
	assertEquals(rewiredOcc, listRewiredOcc);
	assertEquals(rewiredOcc?.workId, survivorBundle.work.id);

	// 次に、mergedIntoWorkIdを持つWorkに直接紐づくOccurrenceが存在する状態（可視性差の検証）
	const mergedWorkId = crypto.randomUUID();
	const mergedBranchId = crypto.randomUUID();
	const mergedOccId = crypto.randomUUID();
	const snapshot = await store.exportGraphState();
	snapshot.works.push({
		id: mergedWorkId,
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
		mergedIntoWorkId: survivorBundle.work.id,
		mergedAt: UPDATED_AT,
	});
	snapshot.branches.push({
		id: mergedBranchId,
		workId: mergedWorkId,
		name: "main",
		headRevisionId: null,
		createdAt: CREATED_AT,
	});
	snapshot.workingCopies.push({
		branchId: mergedBranchId,
		workId: mergedWorkId,
		text: "merged work text",
		updatedAt: CREATED_AT,
	});
	snapshot.occurrences.push({
		id: mergedOccId,
		workId: mergedWorkId,
		parentOccurrenceId: null,
		orderKey: 5000,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: mergedBranchId },
	});
	await store.restoreGraphState(snapshot);

	// listOccurrences(false) は mergedIntoWorkId を除外する
	assertEquals(
		(await store.listOccurrences(false)).find((o) => o.id === mergedOccId),
		undefined,
	);
	// getOccurrence も null を返す
	assertEquals(await store.getOccurrence(mergedOccId), null);
	// listItems(false) は mergedIntoWorkId を除外しない（!work.deletedAt のみ）
	const listItemMerged = (await store.listItems()).find((i) => i.id === mergedOccId);
	const itemMerged = await store.getItem(mergedOccId);
	assertEquals(itemMerged, listItemMerged);
	assertEquals(itemMerged?.text, "merged work text");

	// 7. missing
	assertEquals(await store.getItem("non-existent-id"), null);
	assertEquals(await store.getOccurrence("non-existent-id"), null);

	// 8. mutation 不透過性 (caller mutation does not affect store state)
	const mutableItem = await store.getItem(normal.occurrence.id);
	assert(mutableItem !== null);
	mutableItem.text = "tampered text";
	mutableItem.revisionSelector.mode = "pinned";
	const freshItem = await store.getItem(normal.occurrence.id);
	assertEquals(freshItem?.text, "point-read normal text");
	assertEquals(freshItem?.revisionSelector.mode, "branch");

	const mutableOcc = await store.getOccurrence(normal.occurrence.id);
	assert(mutableOcc !== null);
	mutableOcc.contextualHeading = "tampered heading";
	const freshOcc = await store.getOccurrence(normal.occurrence.id);
	assertEquals(freshOcc?.contextualHeading, undefined);
}

function blankUnplaced(stub?: Work["stub"]): { work: Work; branch: Branch; copy: WorkingCopy } {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	return {
		work: {
			id: workId,
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
			...(stub ? { stub } : {}),
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
			text: "",
			updatedAt: CREATED_AT,
		},
	};
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
