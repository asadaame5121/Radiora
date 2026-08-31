<script lang="ts">
	import { Tabs } from "bits-ui";
	import { LINK_TYPES, type LinkType } from "../domain/models";
	import type { GlobalLineageFilter } from "../services/global_lineage_filter";
	import type { UiVocabulary } from "../shared/ui_vocabulary";

	let { filter, vocabulary, onFilterChange }: {
		filter: GlobalLineageFilter;
		vocabulary: UiVocabulary;
		onFilterChange: (filter: GlobalLineageFilter) => void;
	} = $props();

	function setLinkType(type: LinkType, enabled: boolean): void {
		const linkTypes = enabled ? [...filter.linkTypes, type] : filter.linkTypes.filter((candidate) => candidate !== type);
		onFilterChange({ ...filter, linkTypes });
	}
</script>

<Tabs.Content value="filter">
	{#snippet child({ props })}
		<div {...props} class="sidebar-pane filter-pane">
			<header class="pane-heading"><p class="eyebrow">FILTERS</p><h2>表示条件</h2></header>
			<label class="filter-toggle">
				<input type="checkbox" checked={filter.includeIsolated} onchange={(event) => onFilterChange({ ...filter, includeIsolated: event.currentTarget.checked })} />
				孤立{vocabulary.work}を表示
			</label>
			<div class="filter-types">
				{#each [...LINK_TYPES] as type (type)}
					<!-- biome-ignore lint/a11y/noLabelWithoutControl: The checkbox is directly nested in this label. -->
					<label class="filter-toggle"><input type="checkbox" checked={filter.linkTypes.includes(type)} onchange={(event) => setLinkType(type, event.currentTarget.checked)} /> {type}</label>
				{/each}
			</div>
			<div class="filter-actions">
				<button type="button" onclick={() => onFilterChange({ ...filter, linkTypes: [...LINK_TYPES] })}>すべて選択</button>
				<button type="button" onclick={() => onFilterChange({ ...filter, linkTypes: [] })}>すべて解除</button>
			</div>
		</div>
	{/snippet}
</Tabs.Content>

<style>
	.sidebar-pane { min-width: 0; }
	.pane-heading h2 { margin: 3px 0 12px; color: var(--text); font-size: 13px; }
	.filter-toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; color: var(--text); font-size: 12px; cursor: pointer; }
	.filter-toggle input { accent-color: var(--cyan); }
	.filter-types { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
	.filter-actions { display: flex; gap: 8px; margin-top: 12px; }
	.filter-actions button { border: 1px solid var(--border); border-radius: 5px; background: var(--surface-raised); color: var(--text); font-size: 10px; line-height: 26px; cursor: pointer; }
	.filter-actions button:hover { border-color: var(--cyan); color: var(--cyan); }
</style>
