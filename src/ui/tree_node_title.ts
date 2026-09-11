import type { TreeLayoutNode } from "./tree_layout.ts";

export function nodeTitle(node: TreeLayoutNode): string {
	if (node.aggregate) return `${node.count}件の思索。クリックで右側に表示`;
	const parsed = new Date(node.item.createdAt);
	const createdAt = Number.isFinite(parsed.getTime())
		? new Intl.DateTimeFormat("ja-JP", {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(parsed)
		: node.item.createdAt;
	const knot = node.isLineageKnot ? "\nFROM循環を検出：Knot帯へ退避" : "";
	return `${node.item.text}\n作成: ${createdAt}${knot}`;
}
