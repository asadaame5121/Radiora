<script lang="ts">
	import { LINK_TYPES } from "../domain/models";
	import type { GlobalLineageProjection } from "../services/branch_service";
	import type { GlobalLineageFilter } from "../services/global_lineage_filter";
	import type { TreeBounds } from "./tree_camera";
	import type { TreeLayoutNode } from "./tree_layout";
	import GlobalLineageSidebar from "./GlobalLineageSidebar.svelte";
	import PhylogeneticTree from "./PhylogeneticTree.svelte";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		projection,
		selectedId = null,
		filter,
		onFilterChange,
		onSelect,
		onOpen,
		onContextMenu,
		onProjectionChange,
	}: {
		projection: GlobalLineageProjection;
		selectedId?: string | null;
		filter: GlobalLineageFilter;
		onFilterChange: (filter: GlobalLineageFilter) => void;
		onSelect: (id: string | null) => void;
		onOpen: (id: string) => void;
		onContextMenu: (id: string, event: MouseEvent | KeyboardEvent) => void;
		onProjectionChange?: (projection: import("./tree_layout").TreeProjection) => void;
	} = $props();

	const vocabulary = useUiVocabulary();

	type SidebarTab = "inspect" | "displayed" | "filter";
	let activeTab = $state<SidebarTab>("displayed");
	let inspectCluster = $state<TreeLayoutNode | null>(null);
	let treeElement: PhylogeneticTree | null = null;

	const activeConditionCount = $derived(
		(LINK_TYPES.length - filter.linkTypes.length) + (filter.includeIsolated ? 0 : 1),
	);
	const isFilterActive = $derived(
		projection.filteredWorkCount < projection.totalWorkCount || activeConditionCount > 0,
	);

	$effect(() => {
		// When the filter changes remove the inspected cluster, close the
		// inspection pane and reveal the filter tab so the cause is visible.
		if (!inspectCluster) return;
		const present = inspectCluster.itemIds.every((id) =>
			projection.snapshot.items.some((item) => item.id === id)
		);
		if (present) return;
		inspectCluster = null;
		activeTab = "filter";
	});

	function handleInspectCluster(cluster: TreeLayoutNode): void {
		inspectCluster = cluster;
		activeTab = "inspect";
	}

	function zoomToCluster(bounds: TreeBounds | undefined): void {
		if (!bounds) return;
		treeElement?.zoomToBounds(bounds);
	}
</script>

<section class="global-lineage" aria-label={vocabulary.globalLineage}>
	<div class="lineage-heading">
		<p class="eyebrow">GLOBAL LINEAGE</p>
		<h1>{vocabulary.globalLineage}</h1>
		<p>
			{vocabulary.work}同士の{vocabulary.semanticLink}を表示します。明示した{vocabulary.branch}と
			その確定済み先端の{vocabulary.revision}だけが右側に現れます。
		</p>
		{#if isFilterActive}
			<p class="filter-summary" aria-label="表示件数">
				表示中 {projection.filteredWorkCount} / {projection.totalWorkCount}件
				{activeConditionCount > 0 ? `・条件 ${activeConditionCount}件有効` : ""}
			</p>
		{/if}
	</div>
	<div class="global-tree">
		<PhylogeneticTree
			bind:this={treeElement}
			snapshot={projection.snapshot}
			{selectedId}
			{onSelect}
			{onOpen}
			{onContextMenu}
			{onProjectionChange}
			onInspectCluster={handleInspectCluster}
		/>
	</div>

	<GlobalLineageSidebar
		{projection}
		{selectedId}
		{filter}
		{inspectCluster}
		{activeTab}
		vocabulary={vocabulary}
		onTabChange={(tab) => (activeTab = tab)}
		{onFilterChange}
		{onSelect}
		{onOpen}
		onZoomToCluster={zoomToCluster}
	/>
</section>

<style>
	.global-lineage {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--bg);
	}
	.lineage-heading {
		position: absolute;
		z-index: 2;
		top: 20px;
		left: 22px;
		max-width: 390px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--surface) 88%, transparent);
		pointer-events: none;
	}
	.lineage-heading p,
	.lineage-heading h1 {
		margin: 0;
	}
	.lineage-heading h1 {
		margin-top: 3px;
		color: var(--text);
		font: 22px var(--font-serif);
	}
	.lineage-heading > p:last-child {
		margin-top: 5px;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.6;
	}
	.lineage-heading .filter-summary {
		margin-top: 6px;
		color: var(--amber);
		font-size: 10px;
	}
	.global-tree {
		position: absolute;
		inset: 0 320px 0 0;
	}
	@media (max-width: 1000px) {
		.global-tree {
			right: 0;
		}
	}
</style>
