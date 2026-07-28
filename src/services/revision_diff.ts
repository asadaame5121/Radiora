import type { Revision } from "../domain/models.ts";

export type RevisionDiffKind = "equal" | "add" | "remove";

export interface RevisionDiffNode {
	kind: RevisionDiffKind;
	text: string;
	leftLineNumber?: number;
	rightLineNumber?: number;
}

export interface RevisionComparisonSelection {
	leftRevisionId: string;
	rightRevisionId: string;
}

export function chooseInitialRevisionComparison(
	revisions: readonly Revision[],
	preferredRevisionId?: string,
): RevisionComparisonSelection | null {
	if (revisions.length < 2) return null;
	const selected = revisions.find((revision) => revision.id === preferredRevisionId) ??
		revisions.at(-1)!;
	const parent = selected.parentRevisionIds
		.map((id) => revisions.find((revision) => revision.id === id))
		.find((revision) => revision !== undefined);
	const opposite = parent ??
		[...revisions].reverse().find((revision) => revision.id !== selected.id);
	if (!opposite) return null;
	return { leftRevisionId: opposite.id, rightRevisionId: selected.id };
}

/**
 * Computes a deterministic, line-oriented diff without modifying either input.
 *
 * Lines are compared as exact Unicode strings. CRLF and CR are treated as line
 * boundaries so that platform line endings do not create false content changes.
 * When more than one shortest diff exists, removals are emitted before additions.
 */
export function diffRevisionText(leftText: string, rightText: string): RevisionDiffNode[] {
	const left = splitLines(leftText);
	const right = splitLines(rightText);
	const commonSuffixLengths = Array.from(
		{ length: left.length + 1 },
		() => new Uint32Array(right.length + 1),
	);

	for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex--) {
		for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex--) {
			commonSuffixLengths[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
				? commonSuffixLengths[leftIndex + 1][rightIndex + 1] + 1
				: Math.max(
					commonSuffixLengths[leftIndex + 1][rightIndex],
					commonSuffixLengths[leftIndex][rightIndex + 1],
				);
		}
	}

	const nodes: RevisionDiffNode[] = [];
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length || rightIndex < right.length) {
		if (
			leftIndex < left.length &&
			rightIndex < right.length &&
			left[leftIndex] === right[rightIndex]
		) {
			nodes.push({
				kind: "equal",
				text: left[leftIndex],
				leftLineNumber: leftIndex + 1,
				rightLineNumber: rightIndex + 1,
			});
			leftIndex++;
			rightIndex++;
			continue;
		}
		if (
			leftIndex < left.length &&
			(
				rightIndex >= right.length ||
				commonSuffixLengths[leftIndex + 1][rightIndex] >=
					commonSuffixLengths[leftIndex][rightIndex + 1]
			)
		) {
			nodes.push({
				kind: "remove",
				text: left[leftIndex],
				leftLineNumber: leftIndex + 1,
			});
			leftIndex++;
			continue;
		}
		nodes.push({
			kind: "add",
			text: right[rightIndex],
			rightLineNumber: rightIndex + 1,
		});
		rightIndex++;
	}
	return nodes;
}

function splitLines(text: string): string[] {
	return text === "" ? [] : text.split(/\r\n|\r|\n/);
}
