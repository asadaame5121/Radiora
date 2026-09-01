import {
	type LinkType,
	type OutlineItem,
	type OutlineLink,
	type RelationTypeDefinition,
} from "../domain/models.ts";
import { BUILT_IN_RELATION_TYPES, isRelationTypeSymmetric } from "../domain/relation_type.ts";
import { titleFromText } from "./search_text.ts";

export type SemanticLinkAnnotationDirection = "outgoing" | "incoming" | "symmetric";

/**
 * Read-only link metadata projected onto one concrete outline occurrence.
 *
 * The semantic link itself remains Work/Revision scoped. `occurrenceId` is
 * only the placement that receives this transient annotation; it is not a
 * persisted link endpoint and must not be used to mutate the graph.
 */
export interface SemanticLinkAnnotation {
	occurrenceId: string;
	workId: string;
	linkId: string;
	type: LinkType;
	direction: SemanticLinkAnnotationDirection;
	otherWorkId: string;
	otherDisplayName: string;
	reason: string;
}

/**
 * Projects active, explained semantic links onto every matching occurrence.
 *
 * The function is intentionally pure: it only reads the supplied arrays and
 * returns new annotation objects. A Work with multiple placements therefore
 * receives one annotation per placement, while link order and item order do
 * not affect the returned order.
 */
export function projectSemanticLinkAnnotations(
	items: readonly OutlineItem[],
	links: readonly OutlineLink[],
	relationTypeDefinitions: readonly RelationTypeDefinition[] = BUILT_IN_RELATION_TYPES,
): SemanticLinkAnnotation[] {
	const itemsByWorkId = new Map<string, OutlineItem[]>();
	for (const item of items) {
		const placements = itemsByWorkId.get(item.workId) ?? [];
		placements.push(item);
		itemsByWorkId.set(item.workId, placements);
	}

	const displayNameByWorkId = new Map<string, string>();
	for (const [workId, placements] of itemsByWorkId) {
		const representative = [...placements].sort(compareOccurrences)[0];
		if (representative) displayNameByWorkId.set(workId, displayNameFor(representative));
	}

	const annotations: SemanticLinkAnnotation[] = [];
	for (const link of links) {
		if (link.status === "retracted") continue;
		const reason = link.reason?.trim();
		if (!reason) continue;

		const fromWorkId = link.from.workId;
		const toWorkId = link.to.workId;
		// A self-link has no meaningful "other" Work and is invalid for the
		// current semantic-link operations. Ignore legacy data defensively.
		if (fromWorkId === toWorkId) continue;

		const symmetric = isRelationTypeSymmetric(link.type, relationTypeDefinitions);
		appendAnnotations(
			annotations,
			itemsByWorkId.get(fromWorkId) ?? [],
			link,
			symmetric ? "symmetric" : "outgoing",
			toWorkId,
			displayNameByWorkId.get(toWorkId) ?? toWorkId,
			reason,
		);
		appendAnnotations(
			annotations,
			itemsByWorkId.get(toWorkId) ?? [],
			link,
			symmetric ? "symmetric" : "incoming",
			fromWorkId,
			displayNameByWorkId.get(fromWorkId) ?? fromWorkId,
			reason,
		);
	}

	return annotations.sort(compareAnnotations);
}

function appendAnnotations(
	result: SemanticLinkAnnotation[],
	placements: readonly OutlineItem[],
	link: OutlineLink,
	direction: SemanticLinkAnnotationDirection,
	otherWorkId: string,
	otherDisplayName: string,
	reason: string,
): void {
	for (const placement of placements) {
		result.push({
			occurrenceId: placement.id,
			workId: placement.workId,
			linkId: link.id,
			type: link.type,
			direction,
			otherWorkId,
			otherDisplayName,
			reason,
		});
	}
}

function displayNameFor(item: OutlineItem): string {
	const contextualHeading = item.contextualHeading?.trim();
	return contextualHeading || titleFromText(item.text);
}

function compareOccurrences(left: OutlineItem, right: OutlineItem): number {
	return compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id);
}

function compareAnnotations(left: SemanticLinkAnnotation, right: SemanticLinkAnnotation): number {
	return compareText(left.occurrenceId, right.occurrenceId) ||
		compareText(left.type, right.type) ||
		compareDirection(left.direction, right.direction) ||
		compareText(left.otherWorkId, right.otherWorkId) ||
		compareText(left.otherDisplayName, right.otherDisplayName) ||
		compareText(left.reason, right.reason) ||
		compareText(left.linkId, right.linkId);
}

function compareDirection(
	left: SemanticLinkAnnotationDirection,
	right: SemanticLinkAnnotationDirection,
): number {
	const order: Record<SemanticLinkAnnotationDirection, number> = {
		outgoing: 0,
		incoming: 1,
		symmetric: 2,
	};
	return order[left] - order[right];
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
