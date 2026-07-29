import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";

interface ExportNode {
	readonly item: OutlineItem;
	readonly index: number;
}

/**
 * Renders every placement in an outline snapshot to one deterministic Markdown document.
 *
 * Parent cycles, missing parents, and duplicate occurrence IDs are tolerated: after all
 * ordinary roots have been visited, any remaining placement becomes a recovery root.
 */
export function renderOutlineSnapshotMarkdown(snapshot: OutlineSnapshot): string {
	const nodes = snapshot.items.map((item, index) => ({ item, index }));
	const primaryNodeById = new Map<string, ExportNode>();
	for (const node of nodes) {
		if (!primaryNodeById.has(node.item.id)) primaryNodeById.set(node.item.id, node);
	}

	const children = new Map<number, ExportNode[]>();
	const roots: ExportNode[] = [];
	for (const node of nodes) {
		const parent = node.item.parentId === null
			? undefined
			: primaryNodeById.get(node.item.parentId);
		if (!parent || parent.index === node.index) {
			roots.push(node);
			continue;
		}
		const bucket = children.get(parent.index) ?? [];
		bucket.push(node);
		children.set(parent.index, bucket);
	}
	for (const bucket of children.values()) bucket.sort(compareNodes);
	roots.sort(compareNodes);

	const stashIds = new Set(snapshot.stashItemIds);
	const visited = new Set<number>();
	const rendered: string[] = [];
	const visit = (node: ExportNode, depth: number): void => {
		if (visited.has(node.index)) return;
		visited.add(node.index);
		rendered.push(renderItem(node.item, depth, stashIds.has(node.item.id)));
		for (const child of children.get(node.index) ?? []) visit(child, depth + 1);
	};

	for (const root of roots) visit(root, 0);
	// Cycles and duplicate-ID ambiguities may not have a reachable root.
	for (const node of [...nodes].sort(compareNodes)) {
		if (!visited.has(node.index)) visit(node, 0);
	}

	return rendered.length === 0 ? "" : `${rendered.join("\n\n")}\n`;
}

function compareNodes(left: ExportNode, right: ExportNode): number {
	const leftOrder = Number.isFinite(left.item.orderKey)
		? left.item.orderKey
		: Number.POSITIVE_INFINITY;
	const rightOrder = Number.isFinite(right.item.orderKey)
		? right.item.orderKey
		: Number.POSITIVE_INFINITY;
	return leftOrder - rightOrder ||
		left.item.id.localeCompare(right.item.id) ||
		left.index - right.index;
}

function renderItem(item: OutlineItem, depth: number, stashed: boolean): string {
	const lines = item.text.split(/\r?\n/);
	const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
	const contextualHeading = item.contextualHeading?.trim();
	const heading = contextualHeading ||
		(firstContentIndex >= 0 ? lines[firstContentIndex].trim() : "(空の項目)");
	const body = contextualHeading
		? item.text.replaceAll("\r\n", "\n")
		: firstContentIndex < 0
		? ""
		: lines.slice(firstContentIndex + 1).join("\n");
	const level = Math.min(depth + 1, 6);
	const depthMarker = depth >= 6 ? `↳ 深さ ${depth + 1}: ` : "";
	const stashMarker = stashed ? "[Stash] " : "";
	const section = `${"#".repeat(level)} ${depthMarker}${stashMarker}${heading}`;
	return body.length === 0 ? section : `${section}\n\n${body}`;
}
