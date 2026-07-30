import type { OutlineItem, RevisionSelector } from "../domain/models.ts";

/** The minimal read-only boundary needed to resolve an Occurrence manuscript. */
export interface ManuscriptProjectionSource {
	listItems(): Promise<OutlineItem[]>;
}

/** One contiguous manuscript section derived from exactly one Occurrence. */
export interface ManuscriptSection {
	occurrenceId: string;
	workId: string;
	depth: number;
	heading: string;
	body: string;
	text: string;
	revisionSelector: RevisionSelector;
}

/**
 * Projects one Occurrence subtree into ordered manuscript sections.
 * Text is deliberately taken from listItems(), whose store implementation has
 * already resolved the Occurrence's selected Branch or pinned Revision.
 */
export class ManuscriptProjectionService {
	constructor(private readonly source: ManuscriptProjectionSource) {}

	async project(rootOccurrenceId: string): Promise<ManuscriptSection[]> {
		const items = await this.source.listItems();
		const root = items.find((item) => item.id === rootOccurrenceId);
		if (!root) throw new Error(`Manuscript root Occurrence not found: ${rootOccurrenceId}`);
		const childrenByParent = new Map<string, OutlineItem[]>();
		for (const item of items) {
			if (!item.parentId) continue;
			const children = childrenByParent.get(item.parentId) ?? [];
			children.push(item);
			childrenByParent.set(item.parentId, children);
		}
		for (const children of childrenByParent.values()) {
			children.sort((left, right) =>
				left.orderKey - right.orderKey || left.id.localeCompare(right.id)
			);
		}

		const sections: ManuscriptSection[] = [];
		const visited = new Set<string>();
		const visit = (item: OutlineItem, depth: number): void => {
			if (visited.has(item.id)) return;
			visited.add(item.id);
			sections.push(manuscriptSectionFromItem(item, depth));
			if (item.referenceStub) return;
			for (const child of childrenByParent.get(item.id) ?? []) visit(child, depth + 1);
		};
		visit(root, 0);
		return sections;
	}
}

export function manuscriptSectionFromItem(
	item: OutlineItem,
	depth: number,
): ManuscriptSection {
	const normalizedText = item.text.replaceAll("\r\n", "\n");
	const lines = normalizedText.split("\n");
	const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
	const contextualHeading = item.contextualHeading?.trim();
	const heading = contextualHeading ||
		(firstContentIndex >= 0 ? lines[firstContentIndex].trim() : "(空の項目)");
	const body = contextualHeading
		? normalizedText
		: firstContentIndex < 0
		? ""
		: lines.slice(firstContentIndex + 1).join("\n");
	return {
		occurrenceId: item.id,
		workId: item.workId,
		depth,
		heading,
		body,
		text: normalizedText,
		revisionSelector: structuredClone(item.revisionSelector),
	};
}
