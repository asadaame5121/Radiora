import { expect, test } from "vitest";
import {
	indexSemanticLinkAnnotations,
	reuseSemanticLinkDisplayNames,
} from "../src/services/semantic_link_annotation_index.ts";
import type { SemanticLinkAnnotation } from "../src/services/semantic_link_annotations.ts";

function annotation(occurrenceId: string, linkId: string): SemanticLinkAnnotation {
	return {
		occurrenceId,
		workId: occurrenceId,
		linkId,
		type: "SUPPORT",
		direction: "outgoing",
		otherWorkId: "target",
		otherDisplayName: "Target",
		reason: "explanation",
	};
}

test("an equivalent projection retains the index, row arrays and annotation objects", () => {
	const a = annotation("a", "ab");
	const b = annotation("b", "bc");
	const before = indexSemanticLinkAnnotations([a, b], new Map());
	const next = indexSemanticLinkAnnotations([{ ...a }, { ...b }], before);
	expect(next).toBe(before);
	expect(next.get("a")?.[0]).toBe(a);
});

test("changed rows retain their unchanged annotation objects and remove obsolete rows", () => {
	const first = annotation("a", "first");
	const second = annotation("a", "second");
	const removed = annotation("b", "removed");
	const before = indexSemanticLinkAnnotations([first, second, removed], new Map());
	const changed = { ...second, otherDisplayName: "Renamed" };
	const next = indexSemanticLinkAnnotations([{ ...first }, changed], before);
	expect(next.get("a")).not.toBe(before.get("a"));
	expect(next.get("a")?.[0]).toBe(first);
	expect(next.get("a")?.[1]).toBe(changed);
	expect(next.has("b")).toBe(false);
});

test("display-name reuse is independent of insertion order and invalidates changed or missing names", () => {
	const before = new Map([
		["a", "A"],
		["b", "B"],
	]);
	expect(
		reuseSemanticLinkDisplayNames(
			new Map([
				["b", "B"],
				["a", "A"],
			]),
			before,
		),
	).toBe(before);
	expect(
		reuseSemanticLinkDisplayNames(
			new Map([
				["a", "Renamed"],
				["b", "B"],
			]),
			before,
		),
	).not.toBe(before);
	expect(reuseSemanticLinkDisplayNames(new Map([["a", "A"]]), before)).not.toBe(before);
});
