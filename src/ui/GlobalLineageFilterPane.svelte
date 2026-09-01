<script lang="ts">
	import { Tabs } from "bits-ui";
	import type { LinkType, RelationTypeDefinition } from "../domain/models.ts";
	import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";
	import type { GlobalLineageFilter } from "../services/global_lineage_filter.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";

	let { filter, vocabulary, relationTypeDefinitions, onFilterChange }: {
		filter: GlobalLineageFilter;
		vocabulary: UiVocabulary;
		relationTypeDefinitions?: readonly RelationTypeDefinition[];
		onFilterChange: (filter: GlobalLineageFilter) => void;
	} = $props();

	const definitions = $derived(relationTypeDefinitions ?? BUILT_IN_RELATION_TYPES);

	function setLinkType(type: LinkType, enabled: boolean): void {
		const linkTypes = enabled
			? (filter.linkTypes.includes(type) ? filter.linkTypes : [...filter.linkTypes, type])
			: filter.linkTypes.filter((candidate) => candidate !== type);
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
				{#each definitions as def (def.name)}
					<!-- biome-ignore lint/a11y/noLabelWithoutControl: The checkbox is directly nested in this label. -->
					<label class="filter-toggle"><input type="checkbox" checked={filter.linkTypes.includes(def.name)} onchange={(event) => setLinkType(def.name, event.currentTarget.checked)} /> {def.name}</label>
				{/each}
			</div>
			<div class="filter-actions">
				<button type="button" onclick={() => onFilterChange({ ...filter, linkTypes: definitions.map((d) => d.name) })}>すべて選択</button>
				<button type="button" onclick={() => onFilterChange({ ...filter, linkTypes: [] })}>すべて解除</button>
			</div>
		</div>
	{/snippet}
</Tabs.Content>

<style>
	.sidebar-pane { min-width: 0; }
	.pane-heading h2 { margin: 3px 0 12px; color: var(--text); font-size: 13px; }
	.filter-toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; color: var(--theme-text, #b6c9d1); font-size: 12px; cursor: pointer; }
	.filter-toggle input { accent-color: var(--cyan); }
	.filter-types { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--theme-border, #17313e); }
	.filter-actions { display: flex; gap: 8px; margin-top: 12px; }
	.filter-actions button { border: 1px solid var(--border-bright); border-radius: 5px; background: var(--theme-surface-raised, #0d1b26); color: var(--theme-text, #b6c9d1); font-size: 10px; line-height: 26px; cursor: pointer; }
	.filter-actions button:hover { border-color: var(--cyan); color: var(--theme-cyan, #eafcfd); }
</style>
