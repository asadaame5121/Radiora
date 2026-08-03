import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import type { InternalReferenceResolution } from "./internal_reference_service.ts";
import { rewriteCanonicalInternalReferences } from "./markdown_parser.ts";

export type MarkdownExportReferenceMode = "radiora" | "portable" | "obsidian";
export type MarkdownExportScope = "all" | "selected";

export interface MarkdownExportSelectionOptions {
	readonly scope: MarkdownExportScope;
	readonly selectedOccurrenceId: string | null;
	readonly includeAncestors: boolean;
	readonly includeDescendants: boolean;
	readonly includeSemanticNeighbors: boolean;
}

interface ExportNode {
	readonly item: OutlineItem;
	readonly index: number;
}

/**
 * Selects the placements that belong to one Markdown export without mutating the snapshot.
 *
 * Semantic expansion is deliberately limited to one Work-to-Work hop. Outline expansion
 * applies only to the selected placement, never to placements added through semantic links.
 */
export function selectMarkdownExportSnapshot(
	snapshot: OutlineSnapshot,
	options: MarkdownExportSelectionOptions,
): OutlineSnapshot {
	if (options.scope === "all") return copySnapshot(snapshot);
	if (!options.selectedOccurrenceId) {
		throw new RangeError("選択した配置を基準にするには、項目を選択してください。");
	}

	const primaryIndexById = new Map<string, number>();
	for (const [index, item] of snapshot.items.entries()) {
		if (!primaryIndexById.has(item.id)) primaryIndexById.set(item.id, index);
	}
	const selectedIndex = primaryIndexById.get(options.selectedOccurrenceId);
	if (selectedIndex === undefined) {
		throw new RangeError("選択した配置が現在のアウトラインにありません。");
	}

	const includedIndexes = new Set<number>([selectedIndex]);
	if (options.includeAncestors) {
		const seen = new Set<number>();
		let current = selectedIndex;
		while (!seen.has(current)) {
			seen.add(current);
			const parentId = snapshot.items[current].parentId;
			if (parentId === null) break;
			const parentIndex = primaryIndexById.get(parentId);
			if (parentIndex === undefined) break;
			includedIndexes.add(parentIndex);
			current = parentIndex;
		}
	}
	if (options.includeDescendants) {
		const childIndexesByParentId = new Map<string, number[]>();
		for (const [index, item] of snapshot.items.entries()) {
			if (item.parentId === null) continue;
			const children = childIndexesByParentId.get(item.parentId) ?? [];
			children.push(index);
			childIndexesByParentId.set(item.parentId, children);
		}
		const pending = [selectedIndex];
		const traversed = new Set<number>();
		while (pending.length > 0) {
			const current = pending.pop()!;
			if (traversed.has(current)) continue;
			traversed.add(current);
			for (const childIndex of childIndexesByParentId.get(snapshot.items[current].id) ?? []) {
				includedIndexes.add(childIndex);
				pending.push(childIndex);
			}
		}
	}
	if (options.includeSemanticNeighbors) {
		const selectedWorkId = snapshot.items[selectedIndex].workId;
		const neighborWorkIds = new Set<string>();
		for (const link of snapshot.links) {
			if (link.status === "retracted") continue;
			if (link.from.workId === selectedWorkId) neighborWorkIds.add(link.to.workId);
			if (link.to.workId === selectedWorkId) neighborWorkIds.add(link.from.workId);
		}
		for (const [index, item] of snapshot.items.entries()) {
			if (neighborWorkIds.has(item.workId)) includedIndexes.add(index);
		}
	}

	const items = snapshot.items.filter((_, index) => includedIndexes.has(index));
	const includedIds = new Set(items.map((item) => item.id));
	const includedWorkIds = new Set(items.map((item) => item.workId));
	return {
		items,
		links: snapshot.links.filter((link) =>
			includedWorkIds.has(link.from.workId) && includedWorkIds.has(link.to.workId)
		),
		knots: snapshot.knots.filter((knot) => knot.cycleIds.some((id) => includedIds.has(id))),
		stashItemIds: snapshot.stashItemIds.filter((id) => includedIds.has(id)),
	};
}

function copySnapshot(snapshot: OutlineSnapshot): OutlineSnapshot {
	return {
		items: [...snapshot.items],
		links: [...snapshot.links],
		knots: [...snapshot.knots],
		stashItemIds: [...snapshot.stashItemIds],
	};
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

/**
 * Applies a destination-specific policy to canonical Radiora references.
 *
 * Portable output intentionally discards internal IDs. Obsidian output only
 * converts references proven resolvable by the caller; unresolved references
 * retain their canonical URI so they cannot silently point at an unrelated note.
 */
export function rewriteMarkdownExportReferences(
	markdown: string,
	mode: MarkdownExportReferenceMode,
	resolutions: readonly InternalReferenceResolution[] = [],
): string {
	if (mode === "radiora") return markdown;
	const resolutionByRange = new Map(
		resolutions.map((resolution) => [
			rangeKey(resolution.reference.range.start, resolution.reference.range.end),
			resolution,
		]),
	);
	return rewriteCanonicalInternalReferences(markdown, ({ reference, label }) => {
		if (mode === "portable") return label;
		const resolution = resolutionByRange.get(rangeKey(reference.range.start, reference.range.end));
		if (resolution?.status !== "resolved" || !resolution.displayName) return null;
		return `[[${escapeObsidianLinkText(resolution.displayName)}]]`;
	});
}

function rangeKey(start: number, end: number): string {
	return `${start}:${end}`;
}

function escapeObsidianLinkText(label: string): string {
	return label.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("]", "\\]");
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
