import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { Occurrence, Revision, Work, WorkingCopy } from "../domain/models.ts";
import {
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
