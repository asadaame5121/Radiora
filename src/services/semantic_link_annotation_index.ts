import type { SemanticLinkAnnotation } from "./semantic_link_annotations.ts";

export type SemanticLinkAnnotationIndex = ReadonlyMap<string, readonly SemanticLinkAnnotation[]>;

/** Preserve the names dependency when the effective headings have not changed. */
export function reuseSemanticLinkDisplayNames(
	next: ReadonlyMap<string, string>,
	previous: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
	if (next.size !== previous.size) return next;
	for (const [id, name] of next) {
		if (previous.get(id) !== name) return next;
	}
	return previous;
}

/** Group once; preserve unchanged row arrays and annotation objects across projections. */
export function indexSemanticLinkAnnotations(
	annotations: readonly SemanticLinkAnnotation[],
	previous: SemanticLinkAnnotationIndex,
): SemanticLinkAnnotationIndex {
	const grouped = new Map<string, SemanticLinkAnnotation[]>();
	for (const annotation of annotations) {
		const bucket = grouped.get(annotation.occurrenceId) ?? [];
		bucket.push(annotation);
		grouped.set(annotation.occurrenceId, bucket);
	}
	const next = new Map<string, readonly SemanticLinkAnnotation[]>();
	for (const [id, annotationsForRow] of grouped) {
		const before = previous.get(id);
		const beforeByLink = new Map(before?.map((annotation) => [annotation.linkId, annotation]));
		const reusable = annotationsForRow.map((annotation) => {
			const old = beforeByLink.get(annotation.linkId);
			return old && sameAnnotation(old, annotation) ? old : annotation;
		});
		next.set(
			id,
			before && before.length === reusable.length &&
				before.every((annotation, index) => annotation === reusable[index])
				? before
				: reusable,
		);
	}
	if (next.size !== previous.size) return next;
	for (const [id, annotationsForRow] of next) {
		if (previous.get(id) !== annotationsForRow) return next;
	}
	return previous;
}

function sameAnnotation(left: SemanticLinkAnnotation, right: SemanticLinkAnnotation): boolean {
	return left.occurrenceId === right.occurrenceId &&
		left.workId === right.workId &&
		left.linkId === right.linkId &&
		left.type === right.type &&
		left.direction === right.direction &&
		left.otherWorkId === right.otherWorkId &&
		left.otherDisplayName === right.otherDisplayName &&
		left.reason === right.reason;
}
