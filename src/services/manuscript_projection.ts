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

function childrenByParent(items: readonly OutlineItem[]): Map<string, OutlineItem[]> {
	const childrenByParent = new Map<string, OutlineItem[]>();
	for (const item of items) {
		if (!item.parentId) continue;
		const children = childrenByParent.get(item.parentId) ?? [];
		children.push(item);
		childrenByParent.set(item.parentId, children);
	}
	for (const children of childrenByParent.values()) {
		children.sort(
			(left, right) => left.orderKey - right.orderKey || left.id.localeCompare(right.id),
		);
	}
	return childrenByParent;
}

function collectSections(
	root: OutlineItem,
	childrenByParent: ReadonlyMap<string, OutlineItem[]>,
): ManuscriptSection[] {
	const sections: ManuscriptSection[] = [];
	const visited = new Set<string>();
	const stack: Array<{ item: OutlineItem; depth: number }> = [{ item: root, depth: 0 }];
	while (stack.length > 0) {
		const entry = stack.pop();
		if (!entry || visited.has(entry.item.id)) continue;
		const { item, depth } = entry;
		visited.add(item.id);
		sections.push(manuscriptSectionFromItem(item, depth));
		if (item.referenceStub) continue;
		const children = childrenByParent.get(item.id) ?? [];
		for (let i = children.length - 1; i >= 0; i--) {
			if (!visited.has(children[i].id)) stack.push({ item: children[i], depth: depth + 1 });
		}
	}
	return sections;
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
		return collectSections(root, childrenByParent(items));
	}
}

export function manuscriptSectionFromItem(item: OutlineItem, depth: number): ManuscriptSection {
	const normalizedText = item.text.replaceAll("\r\n", "\n");
	const lines = normalizedText.split("\n");
	const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
	const contextualHeading = item.contextualHeading?.trim();
	const heading =
		contextualHeading || (firstContentIndex >= 0 ? lines[firstContentIndex].trim() : "(空の項目)");
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
