import type { ManuscriptSection } from "../services/manuscript_projection.ts";

export interface ManuscriptBranchMetric {
	occurrenceId: string;
	heading: string;
	depth: number;
	characterCount: number;
}

export interface ManuscriptMetrics {
	totalCharacterCount: number;
	branches: ManuscriptBranchMetric[];
}

/** Counts Unicode code points, including whitespace and line breaks. */
export function manuscriptCharacterCount(text: string): number {
	return Array.from(text).length;
}

/**
 * Reports the whole manuscript and every root/depth-one subtree in projection order.
 * Occurrences are intentionally counted per display, even when they share one Work.
 */
export function measureManuscript(sections: readonly ManuscriptSection[]): ManuscriptMetrics {
	const totalCharacterCount = sections.reduce(
		(total, section) => total + manuscriptCharacterCount(section.text),
		0,
	);
	const starts = sections.flatMap((section, index) =>
		section.depth === 0 || section.depth === 1 ? [{ section, index }] : []
	);
	const branches = starts.map(({ section, index }) => {
		let characterCount = 0;
		for (let cursor = index; cursor < sections.length; cursor++) {
			if (cursor > index && sections[cursor].depth <= section.depth) break;
			characterCount += manuscriptCharacterCount(sections[cursor].text);
		}
		return {
			occurrenceId: section.occurrenceId,
			heading: section.heading,
			depth: section.depth,
			characterCount,
		};
	});
	return { totalCharacterCount, branches };
}
