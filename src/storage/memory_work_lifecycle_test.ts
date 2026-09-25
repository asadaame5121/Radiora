import { assertEquals, assertThrows } from "jsr:@std/assert";
import { MemoryStateContainer } from "./memory_state_container.ts";
import { applyWorkPurge, applyWorkRestore, applyWorkTrash } from "./memory_work_lifecycle.ts";

Deno.test("applyWorkTrash and applyWorkRestore - updates deletedAt and clears orphans", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.works = [
		{ id: "w1", createdAt: now, updatedAt: now },
	];
	state.occurrences = [
		{
			id: "o1",
			workId: "w1",
			parentOccurrenceId: "nonexistent",
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b1" },
		},
	];

	applyWorkTrash(state, "w1", now);
	assertEquals(state.works[0].deletedAt, now);
	assertEquals(state.works[0].updatedAt, now);

	applyWorkRestore(state, "w1");
	assertEquals(state.works[0].deletedAt, undefined);
	assertEquals(state.occurrences[0].parentOccurrenceId, null);
});

Deno.test("applyWorkPurge - removes work and cascade-deletes related resources", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.works = [
		{ id: "w1", createdAt: now, updatedAt: now, deletedAt: now },
	];
	state.branches = [
		{ id: "b1", workId: "w1", name: "main", headRevisionId: null, createdAt: now },
	];
	state.workingCopies = [
		{ workId: "w1", branchId: "b1", text: "text", updatedAt: now },
	];
	state.occurrences = [
		{
			id: "o1",
			workId: "w1",
			parentOccurrenceId: null,
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b1" },
		},
	];

	const manifest = applyWorkPurge(state, "w1");
	assertEquals(manifest.workId, "w1");
	assertEquals(state.works.length, 0);
	assertEquals(state.branches.length, 0);
	assertEquals(state.workingCopies.length, 0);
	assertEquals(state.occurrences.length, 0);
	assertEquals(state.purgeManifests.length, 1);
});

Deno.test("applyWorkPurge - throws error when work is not in trash", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.works = [
		{ id: "w1", createdAt: now, updatedAt: now },
	];
	assertThrows(
		() => applyWorkPurge(state, "w1"),
		Error,
		"Work must be in trash before it can be purged",
	);
});
