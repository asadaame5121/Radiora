import { assertEquals, assertThrows } from "jsr:@std/assert";
import * as v from "valibot";
import {
	BookmarkSchema,
	BranchSchema,
	KnotSchema,
	OccurrenceSchema,
	OutlineLinkSchema,
	PurgeManifestSchema,
	ResumePositionSchema,
	RevisionSchema,
	SearchAliasSchema,
	SystemRelationSchema,
	UuidSchema,
	WorkingCopySchema,
	WorkSchema,
} from "./schemas.ts";

const VALID_UUID = "12345678-1234-4234-8234-1234567890ab";
const VALID_UUID_2 = "87654321-4321-4321-9321-ba0987654321";
const ISO_NOW = "2026-09-04T12:00:00.000Z";

Deno.test("UuidSchema validates valid UUID and rejects invalid string", () => {
	const valid = v.parse(UuidSchema, VALID_UUID);
	assertEquals(valid, VALID_UUID);

	assertThrows(() => v.parse(UuidSchema, "not-a-uuid"));
	assertThrows(() => v.parse(UuidSchema, ""));
	assertThrows(() => v.parse(UuidSchema, 12345));
});

Deno.test("WorkSchema validates valid Work and rejects invalid fields", () => {
	const validWork = {
		id: VALID_UUID,
		createdAt: ISO_NOW,
		updatedAt: ISO_NOW,
	};
	assertEquals(v.parse(WorkSchema, validWork), validWork);

	const workWithStub = {
		...validWork,
		stub: {
			createdAt: ISO_NOW,
			createdVia: "stub-list" as const,
			context: "test context",
		},
	};
	assertEquals(v.parse(WorkSchema, workWithStub), workWithStub);

	// Invalid UUID
	assertThrows(() => v.parse(WorkSchema, { ...validWork, id: "invalid" }));
	// Invalid date
	assertThrows(() => v.parse(WorkSchema, { ...validWork, createdAt: "not-a-date" }));
	// Invalid stub createdVia
	assertThrows(() =>
		v.parse(WorkSchema, {
			...validWork,
			stub: { createdAt: ISO_NOW, createdVia: "unknown-via" },
		})
	);
});

Deno.test("BranchSchema validates Branch correctly", () => {
	const validBranch = {
		id: VALID_UUID,
		workId: VALID_UUID_2,
		name: "main",
		headRevisionId: null,
		createdAt: ISO_NOW,
	};
	assertEquals(v.parse(BranchSchema, validBranch), validBranch);

	const branchWithRevision = {
		...validBranch,
		headRevisionId: VALID_UUID,
		promotedAt: ISO_NOW,
	};
	assertEquals(v.parse(BranchSchema, branchWithRevision), branchWithRevision);

	assertThrows(() => v.parse(BranchSchema, { ...validBranch, name: 123 }));
});

Deno.test("WorkingCopySchema validates WorkingCopy correctly", () => {
	const validCopy = {
		branchId: VALID_UUID,
		workId: VALID_UUID_2,
		text: "Hello, Radiora!",
		updatedAt: ISO_NOW,
	};
	assertEquals(v.parse(WorkingCopySchema, validCopy), validCopy);

	assertThrows(() => v.parse(WorkingCopySchema, { ...validCopy, branchId: "bad-id" }));
});

Deno.test("OccurrenceSchema validates branch and pinned selector occurrences", () => {
	const branchOccurrence = {
		id: VALID_UUID,
		workId: VALID_UUID_2,
		parentOccurrenceId: null,
		orderKey: 1000,
		collapsed: false,
		revisionSelector: {
			mode: "branch" as const,
			branchId: VALID_UUID,
		},
	};
	assertEquals(v.parse(OccurrenceSchema, branchOccurrence), branchOccurrence);

	const pinnedOccurrence = {
		...branchOccurrence,
		revisionSelector: {
			mode: "pinned" as const,
			revisionId: VALID_UUID,
		},
		contextualHeading: "Chapter 1",
	};
	assertEquals(v.parse(OccurrenceSchema, pinnedOccurrence), pinnedOccurrence);

	// Invalid selector mode
	assertThrows(() =>
		v.parse(OccurrenceSchema, {
			...branchOccurrence,
			revisionSelector: { mode: "unknown", id: VALID_UUID },
		})
	);
});

Deno.test("RevisionSchema validates revisions with kinds", () => {
	const validRevision = {
		id: VALID_UUID,
		workId: VALID_UUID_2,
		text: "Content at revision",
		parentRevisionIds: [VALID_UUID],
		kind: "checkpoint" as const,
		createdAt: ISO_NOW,
	};
	assertEquals(v.parse(RevisionSchema, validRevision), validRevision);

	// Invalid revision kind
	assertThrows(() => v.parse(RevisionSchema, { ...validRevision, kind: "invalid-kind" }));
});

Deno.test("OutlineLinkSchema validates link endpoints and metadata", () => {
	const validLink = {
		id: VALID_UUID,
		fromId: VALID_UUID,
		toId: VALID_UUID_2,
		from: { scope: "work" as const, workId: VALID_UUID },
		to: { scope: "revision" as const, workId: VALID_UUID_2, revisionId: VALID_UUID },
		type: "RELATED",
		status: "asserted" as const,
		origin: "human" as const,
		createdAt: ISO_NOW,
	};
	assertEquals(v.parse(OutlineLinkSchema, validLink), validLink);

	// Invalid link status
	assertThrows(() => v.parse(OutlineLinkSchema, { ...validLink, status: "unknown-status" }));
});

Deno.test("Bookmark and ResumePosition schemas validate correctly", () => {
	const bookmark = {
		id: VALID_UUID,
		workId: VALID_UUID,
		occurrenceId: VALID_UUID_2,
		createdAt: ISO_NOW,
	};
	assertEquals(v.parse(BookmarkSchema, bookmark), bookmark);

	const resume = {
		workId: VALID_UUID,
		occurrenceId: VALID_UUID_2,
		caretOffset: 42,
		updatedAt: ISO_NOW,
	};
	assertEquals(v.parse(ResumePositionSchema, resume), resume);
});

Deno.test("Knot, SystemRelation, SearchAlias, PurgeManifest schemas validate correctly", () => {
	const knot = {
		id: VALID_UUID,
		cycleIds: [VALID_UUID, VALID_UUID_2],
		createdAt: ISO_NOW,
	};
	assertEquals(v.parse(KnotSchema, knot), knot);

	const systemRelation = {
		id: VALID_UUID,
		fromWorkId: VALID_UUID,
		toWorkId: VALID_UUID_2,
		type: "IN" as const,
		createdAt: ISO_NOW,
	};
	assertEquals(v.parse(SystemRelationSchema, systemRelation), systemRelation);

	const alias = {
		id: VALID_UUID,
		canonical: "My Note",
		variants: ["My Note Alias", "MN"],
		createdAt: ISO_NOW,
		updatedAt: ISO_NOW,
	};
	assertEquals(v.parse(SearchAliasSchema, alias), alias);

	const purgeManifest = {
		id: VALID_UUID,
		workId: VALID_UUID,
		occurrenceIds: [VALID_UUID],
		branchIds: [VALID_UUID],
		revisionIds: [VALID_UUID],
		linkIds: [VALID_UUID],
		purgedAt: ISO_NOW,
	};
	assertEquals(v.parse(PurgeManifestSchema, purgeManifest), purgeManifest);
});
