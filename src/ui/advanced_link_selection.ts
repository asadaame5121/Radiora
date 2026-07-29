import type { AdvancedLinkInput } from "../services/advanced_link_parser.ts";
import type { AdvancedLinkSelections } from "../services/advanced_link_resolver.ts";

export interface AdvancedLinkSelectionQueries {
	source?: string;
	target?: string;
}

/** Keeps immutable Work tokens only while their corresponding editor query is unchanged. */
export function reconcileAdvancedLinkSelections(
	parsed: AdvancedLinkInput,
	selections: AdvancedLinkSelections,
	queries: AdvancedLinkSelectionQueries,
): { selections: AdvancedLinkSelections; queries: AdvancedLinkSelectionQueries } {
	const nextSelections = { ...selections };
	const nextQueries = { ...queries };
	if (queries.source !== undefined && parsed.source !== queries.source) {
		delete nextSelections.sourceWorkId;
		delete nextQueries.source;
	}
	if (queries.target !== undefined && parsed.target !== queries.target) {
		delete nextSelections.targetWorkId;
		delete nextQueries.target;
	}
	return { selections: nextSelections, queries: nextQueries };
}
