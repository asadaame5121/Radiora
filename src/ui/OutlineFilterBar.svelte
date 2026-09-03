<script lang="ts">
	import type { OutlineFilter } from "../services/outline_filter.ts";

	let {
		outlineFilter = $bindable(),
		onClear,
	}: {
		outlineFilter: OutlineFilter;
		onClear: () => void;
	} = $props();

	const filterActive = $derived(
		Boolean(outlineFilter.freeText || outlineFilter.tagsAll || outlineFilter.tagsNone),
	);
</script>

<p class="filter-hint">自由語は部分一致 · タグはすべて含む（AND） · NOTタグは除外 · この表示だけに適用</p>
<div class="filter-bar">
	<input
		class="filter-input"
		aria-label="テキストで絞り込み"
		placeholder="テキストで絞り込み…"
		bind:value={outlineFilter.freeText}
	/>
	<input
		class="filter-input"
		aria-label="タグ AND"
		placeholder="#タグ AND"
		bind:value={outlineFilter.tagsAll}
	/>
	<input
		class="filter-input"
		aria-label="タグ NOT"
		placeholder="#除外 NOT"
		bind:value={outlineFilter.tagsNone}
	/>
	<button type="button" onclick={onClear} disabled={!filterActive}>解除</button>
</div>

<style>
	.filter-bar {
		display: flex;
		gap: 6px;
		padding: 8px 10px;
		margin: 8px 0;
		background: var(--surface-raised);
		border-radius: 6px;
		align-items: center;
	}
	.filter-hint {
		margin: 0 0 5px;
		color: var(--muted);
		font-size: 10px;
	}
	.filter-input {
		flex: 1;
		min-width: 80px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		font-size: 11px;
		padding: 4px 8px;
	}
	.filter-input:focus {
		border-color: var(--cyan);
		outline: none;
	}
	.filter-bar button {
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--muted);
		font-size: 11px;
		padding: 4px 10px;
		cursor: pointer;
		white-space: nowrap;
	}
	.filter-bar button:disabled {
		opacity: .3;
		cursor: default;
	}
</style>
