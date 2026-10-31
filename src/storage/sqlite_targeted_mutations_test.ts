import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	planTargetedOccurrenceUpdate,
	type TargetedMutableState,
} from "./sqlite_targeted_mutations.ts";
import type { Occurrence } from "../domain/models.ts";

function createMockTargetedState(): TargetedMutableState {
	const workId = "work-1";
	const branchId = "branch-1";
	const revId = "rev-1";
	const occId = "occ-1";
	return {
		works: [
			{ id: workId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
			{
				id: "work-2",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
		branches: [
			{
				id: branchId,
				workId,
				name: "main",
				headRevisionId: revId,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "branch-2",
				workId: "work-2",
				name: "main",
				headRevisionId: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		workingCopies: [{ branchId, workId, text: "hello", updatedAt: "2026-01-01T00:00:00.000Z" }],
		revisions: [
			{
				id: revId,
				workId,
				text: "hello",
				parentRevisionIds: [],
				kind: "checkpoint",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "rev-2",
				workId: "work-2",
				text: "other",
				parentRevisionIds: [],
				kind: "checkpoint",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		occurrences: [
			{
				id: occId,
				workId,
				parentOccurrenceId: null,
				orderKey: 10,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId },
			},
		],
		bookmarks: [{ id: "bm-1", workId, occurrenceId: occId, createdAt: "2026-01-01T00:00:00.000Z" }],
		resumePosition: {
			workId,
			occurrenceId: occId,
			caretOffset: 3,
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
	};
}

Deno.test("planTargetedOccurrenceUpdate missing ID returns empty no-op step", async () => {
	const state = createMockTargetedState();
	const nonExistent: Occurrence = {
		id: "non-existent-id",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 99,
		collapsed: true,
		revisionSelector: { mode: "branch", branchId: "branch-1" },
	};

	const step = planTargetedOccurrenceUpdate(state, nonExistent);
	assertEquals(step.diff.deletes.length, 0);
	assertEquals(step.diff.upserts.length, 0);
	await step.execute();
	assertEquals(state.occurrences.length, 1);
	step.rollback();
	assertEquals(state.occurrences.length, 1);
});

Deno.test("planTargetedOccurrenceUpdate rejects nonexistent workId", () => {
	const state = createMockTargetedState();
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "nonexistent-work",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "branch-1" },
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate rejects nonexistent branchId", () => {
	const state = createMockTargetedState();
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "nonexistent-branch" },
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate rejects branch from a different work", () => {
	const state = createMockTargetedState();
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "branch-2" }, // branch-2 belongs to work-2
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate rejects nonexistent pinned revisionId", () => {
	const state = createMockTargetedState();
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "pinned", revisionId: "nonexistent-rev" },
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate rejects revision from a different work", () => {
	const state = createMockTargetedState();
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "pinned", revisionId: "rev-2" }, // rev-2 belongs to work-2
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate rejects workId change when bookmark references it with old workId", () => {
	const state = createMockTargetedState();
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "work-2", // changed to work-2, but bm-1 still references work-1
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "branch-2" },
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate rejects workId change when resumePosition references it with old workId", () => {
	const state = createMockTargetedState();
	state.bookmarks = []; // clear bookmarks to isolate resumePosition check
	const invalid: Occurrence = {
		id: "occ-1",
		workId: "work-2", // changed to work-2, but resumePosition still references work-1
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "branch-2" },
	};
	assertThrows(() => planTargetedOccurrenceUpdate(state, invalid));
});

Deno.test("planTargetedOccurrenceUpdate succeeds for valid collapse toggle and supports rollback", async () => {
	const state = createMockTargetedState();
	const updated: Occurrence = {
		id: "occ-1",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: true,
		revisionSelector: { mode: "branch", branchId: "branch-1" },
	};

	const step = planTargetedOccurrenceUpdate(state, updated);
	assertEquals(step.diff.upserts.length, 1);
	assertEquals(step.diff.upserts[0].table, "occurrence");

	await step.execute();
	assertEquals(state.occurrences[0].collapsed, true);

	step.rollback();
	assertEquals(state.occurrences[0].collapsed, false);
});

Deno.test("planTargetedOccurrenceUpdate succeeds for valid pinned revision selector", async () => {
	const state = createMockTargetedState();
	const updated: Occurrence = {
		id: "occ-1",
		workId: "work-1",
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "pinned", revisionId: "rev-1" },
	};

	const step = planTargetedOccurrenceUpdate(state, updated);
	await step.execute();
	assertEquals(state.occurrences[0].revisionSelector.mode, "pinned");
});
