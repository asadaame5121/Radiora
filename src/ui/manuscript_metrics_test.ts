// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import type { ManuscriptSection } from "../services/manuscript_projection.ts";
import { manuscriptCharacterCount, measureManuscript } from "./manuscript_metrics.ts";

function section(
	occurrenceId: string,
	depth: number,
	text: string,
	workId = occurrenceId,
): ManuscriptSection {
	return {
		occurrenceId,
		workId,
		depth,
		heading: occurrenceId,
		body: text,
		text,
		revisionSelector: { mode: "branch", branchId: `${occurrenceId}-branch` },
	};
}

Deno.test("manuscriptCharacterCount counts Unicode code points and whitespace", () => {
	assertEquals(manuscriptCharacterCount("A😀\n "), 4);
});

Deno.test("measureManuscript totals root and immediate branch subtrees in projection order", () => {
	const sections = [
		section("root", 0, "R"),
		section("branch-a", 1, "A", "shared-work"),
		section("leaf-a", 2, "😀\n", "shared-work"),
		section("branch-b", 1, "B"),
	];

	assertEquals(measureManuscript(sections), {
		totalCharacterCount: 5,
		branches: [
			{ occurrenceId: "root", heading: "root", depth: 0, characterCount: 5 },
			{ occurrenceId: "branch-a", heading: "branch-a", depth: 1, characterCount: 3 },
			{ occurrenceId: "branch-b", heading: "branch-b", depth: 1, characterCount: 1 },
		],
	});
});
