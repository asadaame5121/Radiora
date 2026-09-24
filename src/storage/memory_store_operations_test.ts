import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { Occurrence, Revision, Work, WorkingCopy } from "../domain/models.ts";
import { MemoryStateContainer } from "./memory_state_container.ts";
import {
	applyMergeWorks,
	applyWorkPurge,
	applyWorkRestore,
	applyWorkTrash,
	endpointKey,
	mergedBranchName,
	projectOutlineItems,
	replaceEndpointWork,
	validateMergeInput,
} from "./memory_store_operations.ts";

Deno.test("mergedBranchName - generates merged branch names with conflict suffixes", () => {
	const taken = new Set(["merged/work-1/main"]);
	assertEquals(mergedBranchName("work-1", "main", taken), "merged/work-1/main/2");
	assertEquals(mergedBranchName("work-1", "dev", taken), "merged/work-1/dev");
});

Deno.test("replaceEndpointWork - replaces matching endpoint workId", () => {
	const endpoint = { scope: "work" as const, workId: "source-1" };
	const replaced = replaceEndpointWork(endpoint, {
		sourceWorkId: "source-1",
		survivorWorkId: "survivor-1",
		mergedAt: new Date().toISOString(),
	});
	assertEquals(replaced.workId, "survivor-1");
});

Deno.test("endpointKey - formats work and revision scopes correctly", () => {
	assertEquals(
		endpointKey({ scope: "work", workId: "w1" }),
		"work:w1",
	);
	assertEquals(
		endpointKey({ scope: "revision", workId: "w1", revisionId: "r1" }),
		"revision:w1:r1",
	);
});

Deno.test("validateMergeInput - throws error when source equals survivor", () => {
	assertThrows(
		() =>
			validateMergeInput(
				{
					sourceWorkId: "w1",
					survivorWorkId: "w1",
					mergedAt: new Date().toISOString(),
				},
				undefined,
				undefined,
				[],
			),
		Error,
		"Duplicate merge requires two different Works",
	);
});

Deno.test("projectOutlineItems - projects outline items from works, copies and occurrences", () => {
	const works: Work[] = [
		{ id: "w1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
	];
	const workingCopies: WorkingCopy[] = [
		{ workId: "w1", branchId: "b1", text: "Hello World", updatedAt: "2026-01-01T00:00:00Z" },
	];
	const revisions: Revision[] = [];
	const occurrences: Occurrence[] = [
		{
			id: "occ-1",
			workId: "w1",
			parentOccurrenceId: null,
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b1" },
		},
	];

	const items = projectOutlineItems(works, workingCopies, revisions, occurrences, false);
	assertEquals(items.length, 1);
	assertEquals(items[0].id, "occ-1");
	assertEquals(items[0].text, "Hello World");
});

Deno.test("applyMergeWorks - rewires all scoped state and creates tombstone", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.works = [
		{ id: "source", createdAt: now, updatedAt: now },
		{ id: "survivor", createdAt: now, updatedAt: now },
	];
	state.branches = [
		{ id: "b1", workId: "source", name: "main", headRevisionId: null, createdAt: now },
		{ id: "b2", workId: "survivor", name: "main", headRevisionId: null, createdAt: now },
	];
	state.workingCopies = [
		{ workId: "source", branchId: "b1", text: "text1", updatedAt: now },
		{ workId: "survivor", branchId: "b2", text: "text2", updatedAt: now },
	];
	state.occurrences = [
		{
			id: "o1",
			workId: "source",
			parentOccurrenceId: null,
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b1" },
		},
	];

	applyMergeWorks(state, {
		sourceWorkId: "source",
		survivorWorkId: "survivor",
		mergedAt: now,
	});

	const source = state.works.find((w) => w.id === "source");
	assertEquals(source?.mergedIntoWorkId, "survivor");
	assertEquals(source?.mergedAt, now);

	const survivor = state.works.find((w) => w.id === "survivor");
	assertEquals(survivor?.updatedAt, now);

	const b1 = state.branches.find((b) => b.id === "b1");
	assertEquals(b1?.workId, "survivor");
	assertEquals(b1?.name, "merged/source/main");

	const o1 = state.occurrences.find((o) => o.id === "o1");
	assertEquals(o1?.workId, "survivor");
});

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
