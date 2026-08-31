<script lang="ts">
	import { Tabs } from "bits-ui";
	import type { GlobalLineageProjection } from "../services/branch_service";
	import type { UiVocabulary } from "../shared/ui_vocabulary";

	let { projection, vocabulary }: { projection: GlobalLineageProjection; vocabulary: UiVocabulary } = $props();

	function revisionLabel(createdAt: string, message?: string): string {
		const parsed = new Date(createdAt);
		const date = Number.isNaN(parsed.getTime()) ? "日時不明" : parsed.toLocaleDateString("ja-JP");
		return message ? `${date} · ${message}` : date;
	}
</script>

<Tabs.Content value="displayed">
	{#snippet child({ props })}
		<div {...props} role="tabpanel" class="sidebar-pane promoted-lineage" aria-label={`${vocabulary.globalLineage}に表示した${vocabulary.branch}`}>
			<header class="pane-heading">
				<p class="eyebrow">PROMOTED</p>
				<h2>{vocabulary.globalLineage}に表示中</h2>
			</header>
			{#each projection.promotedBranches as entry (entry.branch.id)}
				<article>
					<div><span class="lineage-kind">{vocabulary.branch}</span><strong>{entry.branch.name}</strong></div>
					{#if entry.headRevision}
						<p><span class="lineage-kind">{vocabulary.revision}</span> {revisionLabel(entry.headRevision.createdAt, entry.headRevision.message)}</p>
					{:else}
						<p class="muted">確定した{vocabulary.revision}はありません</p>
					{/if}
				</article>
			{:else}
				<p class="empty">明示して表示した{vocabulary.branch}はありません。</p>
			{/each}
		</div>
	{/snippet}
</Tabs.Content>

<style>
	.sidebar-pane { min-width: 0; }
	.pane-heading h2 { margin: 3px 0 12px; color: var(--text); font-size: 13px; }
	.eyebrow { margin: 0; color: var(--cyan-soft); font-size: 9px; letter-spacing: .16em; }
	.empty, .muted { color: var(--muted); font-size: 11px; line-height: 1.6; }
	.promoted-lineage article { margin-bottom: 10px; padding: 11px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-raised); }
	.promoted-lineage article div { display: flex; align-items: center; gap: 8px; }
	.promoted-lineage article p { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
	.lineage-kind { padding: 2px 5px; border: 1px solid var(--border-bright); border-radius: 4px; color: var(--cyan-soft); font-size: 9px; }
</style>
