<script lang="ts">
	import type { TransientProjectionNode } from "../domain/models.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		nodes,
		onSelectNode,
	}: {
		nodes: TransientProjectionNode[];
		onSelectNode: (node: TransientProjectionNode) => void;
	} = $props();

	const vocabulary = useUiVocabulary();

	function nodeTitle(node: TransientProjectionNode): string {
		const line = node.text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
		return line ?? `(空の${vocabulary.work})`;
	}

	function breadcrumbTitle(node: TransientProjectionNode): string {
		if (!node.breadcrumb?.length) return "";
		return node.breadcrumb.map((id) => id.slice(0, 6)).join(" › ");
	}

	const childrenByIndex = $derived.by(() => {
		const map = new Map<number | undefined, number[]>();
		for (let i = 0; i < nodes.length; i++) {
			const parent = nodes[i].parentNodeIndex;
			const list = map.get(parent) ?? [];
			list.push(i);
			map.set(parent, list);
		}
		return map;
	});

	const rootIndices = $derived.by(() => {
		const roots = [...(childrenByIndex.get(undefined) ?? [])];
		const reachable = new Set<number>();

		function markReachable(idx: number): void {
			if (reachable.has(idx)) return;
			reachable.add(idx);
			for (const childIdx of childrenByIndex.get(idx) ?? []) {
				markReachable(childIdx);
			}
		}

		for (const rootIdx of roots) markReachable(rootIdx);

		// A malformed or cyclic parent chain has no natural root. Treat its first
		// unvisited node as an additional root so the projection remains visible.
		for (let idx = 0; idx < nodes.length; idx++) {
			if (!reachable.has(idx)) {
				roots.push(idx);
				markReachable(idx);
			}
		}

		return roots;
	});

	const depths = $derived.by(() => {
		const result = new Map<number, number>();
		for (const rootIdx of rootIndices) {
			computeDepths(rootIdx, 0, result, new Set<number>());
		}
		return result;
	});

	function computeDepths(
		idx: number,
		depth: number,
		depths: Map<number, number>,
		visited: Set<number>,
	): void {
		if (visited.has(idx)) return;
		visited.add(idx);
		depths.set(idx, depth);
		const children = childrenByIndex.get(idx) ?? [];
		for (const childIdx of children) {
			computeDepths(childIdx, depth + 1, depths, visited);
		}
	}

	const visibleOrder = $derived.by(() => {
		const order: number[] = [];
		const expanded = new Set(expandedIds);
		const visited = new Set<number>();
		for (const rootIdx of rootIndices) {
			addVisible(rootIdx, expanded, order, visited);
		}
		return order;
	});

	function addVisible(
		idx: number,
		expanded: Set<number>,
		order: number[],
		visited: Set<number>,
	): void {
		if (visited.has(idx)) return;
		visited.add(idx);
		order.push(idx);
		const hasKids = (childrenByIndex.get(idx)?.length ?? 0) > 0;
		if (hasKids && expanded.has(idx)) {
			for (const childIdx of childrenByIndex.get(idx) ?? []) {
				addVisible(childIdx, expanded, order, visited);
			}
		}
	}

	let expandedIds = $state<Set<number>>(new Set());

	function toggle(idx: number): void {
		const next = new Set(expandedIds);
		if (next.has(idx)) next.delete(idx);
		else next.add(idx);
		expandedIds = next;
	}

	function hasChildren(idx: number): boolean {
		return (childrenByIndex.get(idx)?.length ?? 0) > 0;
	}

	function isExpanded(idx: number): boolean {
		return expandedIds.has(idx);
	}
</script>

<div class="sparse-outline-view">
	{#if nodes.length === 0}
		<p class="sparse-empty">{vocabulary.noQueryResult}</p>
	{:else}
		<p class="sparse-meta">{nodes.length}件の{vocabulary.queryResult}</p>
		<div class="sparse-tree" role="tree" aria-label={vocabulary.sparseOutline}>
			{#each visibleOrder as idx (nodes[idx].workId + (nodes[idx].occurrenceId ? "-" + nodes[idx].occurrenceId : ""))}
				{@const node = nodes[idx]}
				{@const depth = depths.get(idx) ?? 0}
				{@const isMatched = node.reasons && node.reasons.length > 0}
				{@const expandable = hasChildren(idx)}
				<div class="sparse-node" class:matched={isMatched}>
					<div class="sparse-node-row" style="padding-left: {depth * 1.2}em">
						{#if expandable}
							<button
								class="sparse-disclosure"
								aria-label={isExpanded(idx) ? "折りたたむ" : "展開する"}
								onclick={() => toggle(idx)}
							>{isExpanded(idx) ? "⌄" : "›"}</button>
						{:else}
							<span class="sparse-disclosure sparse-disclosure--spacer"></span>
						{/if}
						<button class="sparse-node-content" onclick={() => onSelectNode(node)}>
							<span class="sparse-node-title">{nodeTitle(node)}</span>
							{#if node.score !== undefined}
								<span class="sparse-node-score">{Math.round(node.score * 100)}%</span>
							{/if}
						</button>
						{#if node.breadcrumb?.length}
							<small class="sparse-node-breadcrumb">{breadcrumbTitle(node)}</small>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.sparse-outline-view {
		font-size: 12px;
	}
	.sparse-meta {
		color: var(--muted);
		margin: 4px 0 8px;
		font-size: 11px;
	}
	.sparse-empty {
		color: var(--muted);
		margin: 12px 0;
	}
	.sparse-tree {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.sparse-node {
		border-left: 2px solid transparent;
	}
	.sparse-node.matched {
		border-left-color: var(--cyan);
		background: rgb(37 198 209 / 6%);
	}
	.sparse-node-row {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 0;
	}
	.sparse-disclosure {
		all: unset;
		cursor: pointer;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: var(--muted);
		flex-shrink: 0;
	}
	.sparse-disclosure:hover {
		color: var(--text);
	}
	.sparse-disclosure--spacer {
		visibility: hidden;
	}
	.sparse-node-content {
		all: unset;
		cursor: pointer;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: 3px;
	}
	.sparse-node-content:hover {
		background: var(--surface-hover);
	}
	.sparse-node-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sparse-node-score {
		font-size: 10px;
		color: var(--cyan);
		background: rgb(37 198 209 / 12%);
		padding: 1px 5px;
		border-radius: 8px;
		flex-shrink: 0;
	}
	.sparse-node-breadcrumb {
		font-size: 10px;
		color: var(--muted);
		flex-shrink: 0;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
