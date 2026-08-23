import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import {
	bookmarkFromRow,
	branchFromRow,
	emergenceFeedbackActionFromRow,
	emergenceSuggestionFromRow,
	itemFromRow,
	knotFromRow,
	occurrenceFromRow,
	optionalRecordDomainId,
	outlineLinkFromRow,
	purgeManifestFromRow,
	recoverySnapshotFromRow,
	resumePositionFromRow,
	revisionFromRow,
	savedRuleQueryFromRow,
	searchAliasFromRow,
	snapshotProtectionFromRow,
	systemRelationFromRow,
	workFromRow,
	workingCopyFromRow,
	workStubFromRow,
} from "./surreal_row_mapper.ts";

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const PARENT_ID = "a3744669-9419-4edb-ab06-09f397c18932";
const REVISION_ID = "5537ca1d-dcd4-43e8-b68d-fbfa672133de";

Deno.test("Surreal row mappers preserve UUID domain boundaries and optional records", () => {
	const base = {
		id: WORK_ID,
		work_id: WORK_ID,
		text: "child",
		parent_id: PARENT_ID,
		selector_mode: "branch",
		branch_id: WORK_ID,
		order_key: 1024,
		collapsed: false,
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T00:00:00.000Z",
	};

	assertEquals(itemFromRow(base).parentId, PARENT_ID);
	assertEquals(itemFromRow({ ...base, parent_id: null }).parentId, null);
	assertThrows(
		() => itemFromRow({ ...base, parent_id: `outline_item:${PARENT_ID}` }),
		TypeError,
		"Expected parent_id to be a UUID",
	);
	assertEquals(
		occurrenceFromRow({
			...base,
			selector_mode: "pinned",
			branch_id: null,
			revision_id: new RecordId("revision", REVISION_ID),
		}).revisionSelector,
		{ mode: "pinned", revisionId: REVISION_ID },
	);
	assertEquals(
		revisionFromRow({
			id: REVISION_ID,
			work_id: WORK_ID,
			text: "revision",
			parent_revisions: [new RecordId("revision", REVISION_ID)],
			kind: "edition",
			created_at: base.created_at,
		}).parentRevisionIds,
		[REVISION_ID],
	);
	assertEquals(optionalRecordDomainId(new RecordId("revision", REVISION_ID)), REVISION_ID);
});

Deno.test("Surreal work row mappers retain complete metadata and omit partial optionals", () => {
	const base = {
		id: WORK_ID,
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T00:01:00.000Z",
		deleted_at: null,
	};
	const cases = [
		{
			name: "complete stub and merge provenance",
			row: {
				...base,
				stub: { created_at: base.created_at, created_via: "stub-list", context: "draft" },
				merged_into_work: new RecordId("work", PARENT_ID),
				merged_at: base.updated_at,
			},
			expected: {
				stub: {
					createdAt: base.created_at,
					createdVia: "stub-list" as const,
					context: "draft",
				},
				mergedIntoWorkId: PARENT_ID,
				mergedAt: base.updated_at,
			},
		},
		{
			name: "partial stub is omitted",
			row: { ...base, stub: { created_via: "stub-list" } },
			expected: {},
		},
	];

	for (const testCase of cases) {
		const work = workFromRow(testCase.row);
		assertEquals(work.stub, testCase.expected.stub, testCase.name);
		assertEquals(work.mergedIntoWorkId, testCase.expected.mergedIntoWorkId, testCase.name);
		assertEquals(work.mergedAt, testCase.expected.mergedAt, testCase.name);
	}
	assertEquals(workStubFromRow({ ...base, stub: [] }), undefined);
	assertEquals(snapshotProtectionFromRow({}), undefined);
	assertEquals(
		snapshotProtectionFromRow({
			protection_reason: "revision-source",
			protected_at: base.created_at,
			protection_expires_at: null,
		}),
		{ reason: "revision-source", protectedAt: base.created_at },
	);
});

const BRANCH_ID = "b48c2e55-6d3a-4f8b-9e1a-7c3d5f8a2b6e";
const OCCURRENCE_ID = "d7f9a1c3-2e4b-4d6a-8c0e-1f3a5b7c9d2e";

Deno.test("Surreal branch and working copy mappers preserve optionals and defaults", () => {
	const branch = branchFromRow({
		id: BRANCH_ID,
		work_id: WORK_ID,
		name: "feature",
		head_revision: new RecordId("revision", REVISION_ID),
		created_at: "2026-07-30T00:00:00.000Z",
		promoted_at: null,
		archived_at: "2026-08-01T00:00:00.000Z",
	});
	assertEquals(branch.id, BRANCH_ID);
	assertEquals(branch.workId, WORK_ID);
	assertEquals(branch.name, "feature");
	assertEquals(branch.headRevisionId, REVISION_ID);
	assertEquals(branch.promotedAt, undefined);
	assertEquals(branch.archivedAt, "2026-08-01T00:00:00.000Z");

	const emptyBranch = branchFromRow({
		id: BRANCH_ID,
		work_id: WORK_ID,
		name: null,
		head_revision: null,
		created_at: null,
		promoted_at: null,
		archived_at: null,
	});
	assertEquals(emptyBranch.name, "");
	assertEquals(emptyBranch.headRevisionId, null);
	assertEquals(emptyBranch.createdAt, "");

	const copy = workingCopyFromRow({
		work_id: WORK_ID,
		branch_id: BRANCH_ID,
		text: "draft content",
		updated_at: "2026-07-30T12:00:00.000Z",
	});
	assertEquals(copy.workId, WORK_ID);
	assertEquals(copy.branchId, BRANCH_ID);
	assertEquals(copy.text, "draft content");
	assertEquals(copy.updatedAt, "2026-07-30T12:00:00.000Z");

	const emptyCopy = workingCopyFromRow({
		work_id: WORK_ID,
		branch_id: BRANCH_ID,
		text: null,
		updated_at: null,
	});
	assertEquals(emptyCopy.text, "");
	assertEquals(emptyCopy.updatedAt, "");
});

Deno.test("Surreal recovery snapshot mapper preserves protection and optional fields", () => {
	const snapshot = recoverySnapshotFromRow({
		id: "snap-1",
		work_id: WORK_ID,
		branch_id: BRANCH_ID,
		text: "snapshot text",
		content_hash: "abc123",
		created_at: "2026-07-30T00:00:00.000Z",
		source_revision: new RecordId("revision", REVISION_ID),
		name: "before-edit",
		protection_reason: "user",
		protected_at: "2026-07-30T00:00:00.000Z",
		protection_expires_at: "2026-08-06T00:00:00.000Z",
	});
	assertEquals(snapshot.id, "snap-1");
	assertEquals(snapshot.workId, WORK_ID);
	assertEquals(snapshot.branchId, BRANCH_ID);
	assertEquals(snapshot.sourceRevisionId, REVISION_ID);
	assertEquals(snapshot.name, "before-edit");
	assertEquals(snapshot.protection, {
		reason: "user",
		protectedAt: "2026-07-30T00:00:00.000Z",
		expiresAt: "2026-08-06T00:00:00.000Z",
	});

	const bare = recoverySnapshotFromRow({
		id: "snap-2",
		work_id: WORK_ID,
		branch_id: BRANCH_ID,
		text: null,
		content_hash: null,
		created_at: null,
		source_revision: null,
		name: null,
		protection_reason: null,
		protected_at: null,
		protection_expires_at: null,
	});
	assertEquals(bare.text, "");
	assertEquals(bare.contentHash, "");
	assertEquals(bare.sourceRevisionId, null);
	assertEquals(bare.name, undefined);
	assertEquals(bare.protection, undefined);
});

Deno.test("Surreal bookmark and resume mappers validate UUID domains", () => {
	const bookmark = bookmarkFromRow({
		id: "bm-1",
		work_id: WORK_ID,
		occurrence_id: OCCURRENCE_ID,
		created_at: "2026-07-30T00:00:00.000Z",
	});
	assertEquals(bookmark.id, "bm-1");
	assertEquals(bookmark.workId, WORK_ID);
	assertEquals(bookmark.occurrenceId, OCCURRENCE_ID);
	assertEquals(bookmark.createdAt, "2026-07-30T00:00:00.000Z");

	assertThrows(
		() => bookmarkFromRow({ id: "bm-2", work_id: "not-a-uuid", occurrence_id: OCCURRENCE_ID }),
		TypeError,
		"Expected work_id to be a UUID",
	);

	const resume = resumePositionFromRow({
		work_id: WORK_ID,
		occurrence_id: OCCURRENCE_ID,
		caret_offset: 42,
		updated_at: "2026-07-30T12:00:00.000Z",
	});
	assertEquals(resume.workId, WORK_ID);
	assertEquals(resume.occurrenceId, OCCURRENCE_ID);
	assertEquals(resume.caretOffset, 42);
	assertEquals(resume.updatedAt, "2026-07-30T12:00:00.000Z");
});

Deno.test("Surreal purge manifest mapper handles array and non-array fields", () => {
	const manifest = purgeManifestFromRow({
		id: "pm-1",
		work_id: WORK_ID,
		occurrence_ids: [OCCURRENCE_ID, PARENT_ID],
		branch_ids: [BRANCH_ID],
		revision_ids: [],
		link_ids: null,
		purged_at: "2026-07-30T00:00:00.000Z",
	});
	assertEquals(manifest.id, "pm-1");
	assertEquals(manifest.workId, WORK_ID);
	assertEquals(manifest.occurrenceIds, [OCCURRENCE_ID, PARENT_ID]);
	assertEquals(manifest.branchIds, [BRANCH_ID]);
	assertEquals(manifest.revisionIds, []);
	assertEquals(manifest.linkIds, []);
	assertEquals(manifest.purgedAt, "2026-07-30T00:00:00.000Z");
});

Deno.test("Surreal link mapper builds scoped endpoints and preserves optional reason", () => {
	const link = outlineLinkFromRow({
		id: "link-1",
		from_scope: "revision",
		from_id: WORK_ID,
		from_revision: new RecordId("revision", REVISION_ID),
		to_scope: "work",
		to_id: PARENT_ID,
		to_revision: null,
		type: "RELATED",
		status: "asserted",
		origin: "human",
		reason: "contextual",
		created_at: "2026-07-30T00:00:00.000Z",
	});
	assertEquals(link.id, "link-1");
	assertEquals(link.from, { scope: "revision", workId: WORK_ID, revisionId: REVISION_ID });
	assertEquals(link.to, { scope: "work", workId: PARENT_ID });
	assertEquals(link.type, "RELATED");
	assertEquals(link.reason, "contextual");

	const noReason = outlineLinkFromRow({
		id: "link-2",
		from_scope: "work",
		from_id: WORK_ID,
		from_revision: null,
		to_scope: "work",
		to_id: PARENT_ID,
		to_revision: null,
		type: "LIKE",
		status: "provisional",
		origin: "suggestion",
		reason: null,
		created_at: null,
	});
	assertEquals(noReason.from, { scope: "work", workId: WORK_ID });
	assertEquals(noReason.reason, undefined);
	assertEquals(noReason.createdAt, "");
});

Deno.test("Surreal system relation, knot, and alias mappers preserve defaults", () => {
	const relation = systemRelationFromRow({
		id: "sr-1",
		from_id: WORK_ID,
		to_id: PARENT_ID,
		type: "IN",
		created_at: "2026-07-30T00:00:00.000Z",
	});
	assertEquals(relation.fromWorkId, WORK_ID);
	assertEquals(relation.toWorkId, PARENT_ID);
	assertEquals(relation.type, "IN");

	const knot = knotFromRow({
		id: "knot-1",
		cycle_ids: [OCCURRENCE_ID, PARENT_ID],
		created_at: "2026-07-30T00:00:00.000Z",
	});
	assertEquals(knot.cycleIds, [OCCURRENCE_ID, PARENT_ID]);

	const emptyKnot = knotFromRow({ id: "knot-2", cycle_ids: null, created_at: null });
	assertEquals(emptyKnot.cycleIds, []);
	assertEquals(emptyKnot.createdAt, "");

	const alias = searchAliasFromRow({
		id: "alias-1",
		canonical: "Radiora",
		variants: ["radiola", "radiora"],
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T12:00:00.000Z",
	});
	assertEquals(alias.canonical, "Radiora");
	assertEquals(alias.variants, ["radiola", "radiora"]);

	const emptyAlias = searchAliasFromRow({
		id: "alias-2",
		canonical: null,
		variants: null,
		created_at: null,
		updated_at: null,
	});
	assertEquals(emptyAlias.canonical, "");
	assertEquals(emptyAlias.variants, []);
});

Deno.test("Surreal emergence suggestion mapper preserves evidence and held-to-pinned mapping", () => {
	const suggestion = emergenceSuggestionFromRow({
		id: "sug-1",
		kind: "semantic",
		context_work_id: WORK_ID,
		target_work_id: PARENT_ID,
		context_occurrence_id: OCCURRENCE_ID,
		target_occurrence_id: "e8a0b2c4-6d8e-4f0a-2b4c-6d8e0f2a4b6c",
		proposed_link_type: "RELATED",
		title: "Possible link",
		explanation: "Shared context",
		evidence: [{ fromId: "a", toId: "b", relation: "FROM" }],
		score: 0.85,
		status: "pending",
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T12:00:00.000Z",
		resolved_at: null,
		resolution_reason: null,
	});
	assertEquals(suggestion.id, "sug-1");
	assertEquals(suggestion.kind, "semantic");
	assertEquals(suggestion.contextWorkId, WORK_ID);
	assertEquals(suggestion.proposedLinkType, "RELATED");
	assertEquals(suggestion.evidence, [{ fromId: "a", toId: "b", relation: "FROM" }]);
	assertEquals(suggestion.score, 0.85);
	assertEquals(suggestion.persistenceStatus, "pending");
	assertEquals(suggestion.resolvedAt, undefined);

	const held = emergenceSuggestionFromRow({
		id: "sug-2",
		kind: "structural",
		context_work_id: WORK_ID,
		target_work_id: PARENT_ID,
		context_occurrence_id: null,
		target_occurrence_id: null,
		proposed_link_type: null,
		title: null,
		explanation: null,
		evidence: null,
		score: null,
		status: "held",
		created_at: null,
		updated_at: null,
		resolved_at: "2026-08-01T00:00:00.000Z",
		resolution_reason: "pinned by user",
	});
	assertEquals(held.status, "pinned");
	assertEquals(held.persistenceStatus, "held");
	assertEquals(held.proposedLinkType, undefined);
	assertEquals(held.evidence, []);
	assertEquals(held.score, 0);
	assertEquals(held.resolvedAt, "2026-08-01T00:00:00.000Z");
	assertEquals(held.resolutionReason, "pinned by user");
});

Deno.test("Surreal saved rule query mapper preserves defaults", () => {
	const query = savedRuleQueryFromRow({
		id: "srq-1",
		name: "orphans",
		source: "SELECT * FROM work",
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T12:00:00.000Z",
	});
	assertEquals(query.id, "srq-1");
	assertEquals(query.name, "orphans");
	assertEquals(query.source, "SELECT * FROM work");

	const empty = savedRuleQueryFromRow({
		id: "srq-2",
		name: null,
		source: null,
		created_at: null,
		updated_at: null,
	});
	assertEquals(empty.name, "");
	assertEquals(empty.source, "");
	assertEquals(empty.createdAt, "");
});

Deno.test("Surreal emergence feedback action validator accepts known actions and rejects others", () => {
	assertEquals(emergenceFeedbackActionFromRow({ action: "accept" }), "accept");
	assertEquals(emergenceFeedbackActionFromRow({ action: "dismiss" }), "dismiss");
	assertEquals(emergenceFeedbackActionFromRow({ action: "pin" }), "pin");
	assertEquals(emergenceFeedbackActionFromRow({ action: "unknown" }), null);
	assertEquals(emergenceFeedbackActionFromRow({ action: null }), null);
	assertEquals(emergenceFeedbackActionFromRow({}), null);
});
