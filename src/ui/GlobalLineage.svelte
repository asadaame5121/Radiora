<script lang="ts">
	import type { GlobalLineageProjection } from "../services/branch_service";
	import PhylogeneticTree from "./PhylogeneticTree.svelte";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		projection,
		selectedId = null,
		onSelect,
		onOpen,
		onContextMenu,
		onProjectionChange,
	}: {
		projection: GlobalLineageProjection;
		selectedId?: string | null;
		onSelect: (id: string | null) => void;
		onOpen: (id: string) => void;
		onContextMenu: (id: string, event: MouseEvent | KeyboardEvent) => void;
		onProjectionChange?: (projection: import("./tree_layout").TreeProjection) => void;
	} = $props();

	const vocabulary = useUiVocabulary();

	function revisionLabel(createdAt: string, message?: string): string {
		const parsed = new Date(createdAt);
		const date = Number.isNaN(parsed.getTime())
			? "日時不明"
			: parsed.toLocaleDateString("ja-JP");
		return message ? `${date} · ${message}` : date;
	}
</script>

<section class="global-lineage" aria-label={vocabulary.globalLineage}>
	<div class="lineage-heading">
		<p class="eyebrow">GLOBAL LINEAGE</p>
		<h1>{vocabulary.globalLineage}</h1>
		<p>
			{vocabulary.work}同士の意味関係を表示します。明示した{vocabulary.branch}と
			その確定済み先端の{vocabulary.revision}だけが右側に現れます。
		</p>
	</div>
	<div class="global-tree">
		<PhylogeneticTree
			snapshot={projection.snapshot}
			{selectedId}
			{onSelect}
			{onOpen}
			{onContextMenu}
			{onProjectionChange}
		/>
	</div>
	<aside class="promoted-lineage" aria-label={`${vocabulary.globalLineage}に表示した${vocabulary.branch}`}>
		<h2>{vocabulary.globalLineage}に表示中</h2>
		{#each projection.promotedBranches as entry (entry.branch.id)}
			<article>
				<div>
					<span class="lineage-kind">{vocabulary.branch}</span>
					<strong>{entry.branch.name}</strong>
				</div>
				{#if entry.headRevision}
					<p>
						<span class="lineage-kind">{vocabulary.revision}</span>
						{revisionLabel(entry.headRevision.createdAt, entry.headRevision.message)}
					</p>
				{:else}
					<p class="muted">確定した{vocabulary.revision}はありません</p>
				{/if}
			</article>
		{:else}
			<p class="empty">明示して表示した{vocabulary.branch}はありません。</p>
		{/each}
	</aside>
</section>

<style>
	.global-lineage {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: #050a10;
	}
	.lineage-heading {
		position: absolute;
		z-index: 2;
		top: 20px;
		left: 22px;
		max-width: 390px;
		padding: 12px 14px;
		border: 1px solid #17313e;
		border-radius: 8px;
		background: rgb(5 10 16 / 88%);
		pointer-events: none;
	}
	.lineage-heading p,
	.lineage-heading h1 {
		margin: 0;
	}
	.lineage-heading h1 {
		margin-top: 3px;
		color: #eafcfd;
		font: 22px Georgia, "Noto Serif JP", serif;
	}
	.lineage-heading > p:last-child {
		margin-top: 5px;
		color: #7f949e;
		font-size: 11px;
		line-height: 1.6;
	}
	.global-tree {
		position: absolute;
		inset: 0 260px 0 0;
	}
	.promoted-lineage {
		position: absolute;
		z-index: 2;
		inset: 0 0 0 auto;
		width: 260px;
		padding: 22px 16px;
		border-left: 1px solid #17313e;
		background: rgb(8 16 26 / 94%);
		overflow: auto;
	}
	.promoted-lineage h2 {
		margin: 0 0 14px;
		color: #dce7ec;
		font-size: 13px;
	}
	.promoted-lineage article {
		margin-bottom: 10px;
		padding: 11px;
		border: 1px solid #17313e;
		border-radius: 7px;
		background: #07121a;
	}
	.promoted-lineage article div {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.promoted-lineage article p {
		margin: 8px 0 0;
		color: #9fb3bc;
		font-size: 11px;
	}
	.lineage-kind {
		padding: 2px 5px;
		border: 1px solid #28546a;
		border-radius: 4px;
		color: #73dce3;
		font-size: 9px;
	}
	.muted,
	.empty {
		color: #657681;
		font-size: 11px;
		line-height: 1.6;
	}
	@media (max-width: 1000px) {
		.global-tree {
			right: 0;
		}
		.promoted-lineage {
			display: none;
		}
	}
</style>
