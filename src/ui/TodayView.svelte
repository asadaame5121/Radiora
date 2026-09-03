<script lang="ts">
	import type { OutlineItem } from "../domain/models.ts";
	import type { DateProjection, DateProjectionEntry } from "../services/date_projection.ts";
	import {
		matchesOutlineFilter,
		type OutlineFilter,
	} from "../services/outline_filter.ts";
	import OutlineFilterBar from "./OutlineFilterBar.svelte";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		dateStart = $bindable(),
		dateEnd = $bindable(),
		outlineFilter = $bindable(),
		projection,
		loading,
		onMoveDateRange,
		onShowWeek,
		onLoad,
		onClearFilter,
		onOpenEntry,
		titleFor,
		formatCreatedAt,
	}: {
		dateStart: string;
		dateEnd: string;
		outlineFilter: OutlineFilter;
		projection: DateProjection | null;
		loading: boolean;
		onMoveDateRange: (days: number) => void | Promise<void>;
		onShowWeek: () => void | Promise<void>;
		onLoad: () => void | Promise<void>;
		onClearFilter: () => void;
		onOpenEntry: (entry: DateProjectionEntry) => void | Promise<void>;
		titleFor: (item: OutlineItem) => string;
		formatCreatedAt: (value: string) => string;
	} = $props();

	const vocabulary = useUiVocabulary();
	const filteredCreated = $derived(filterEntries(projection?.created ?? []));
	const filteredUpdated = $derived(filterEntries(projection?.updated ?? []));

	function filterEntries(entries: DateProjectionEntry[]): DateProjectionEntry[] {
		return entries.filter((entry) =>
			matchesOutlineFilter(entry.representative?.text ?? "", outlineFilter)
		);
	}

	function placementSummary(entry: DateProjectionEntry): string {
		return entry.placements
			.map((placement) =>
				placement.breadcrumb.map(titleFor).concat(titleFor(placement.occurrence)).join(" › ")
			)
			.join(" / ");
	}
</script>

<section class="outline-panel date-projection" aria-label={vocabulary.today}>
	<div class="section-title"><span>{vocabulary.today}</span></div>
	<div class="date-controls">
		<button onclick={() => onMoveDateRange(-1)}>前日</button>
		<button onclick={() => onMoveDateRange(1)}>翌日</button>
		<button onclick={onShowWeek}>週</button>
		<label>開始 <input type="date" bind:value={dateStart} /></label>
		<label>終了（含まない） <input type="date" bind:value={dateEnd} /></label>
		<button onclick={onLoad}>表示</button>
	</div>
	<OutlineFilterBar bind:outlineFilter onClear={onClearFilter} />
	{#if loading}
		<p class="empty">読み込み中…</p>
	{:else if projection}
		<section aria-label="この期間に作成">
			<h2>
				この期間に作成 <small>{filteredCreated.length}件{#if filteredCreated.length !== projection.created.length} / {projection.created.length}件{/if}</small>
			</h2>
			{#each filteredCreated as entry (entry.work.id)}
				<button class="date-entry" onclick={() => onOpenEntry(entry)} disabled={!entry.representative}>
					<strong>{entry.representative ? titleFor(entry.representative) : `(未配置の${vocabulary.work})`}</strong>
					<small>{formatCreatedAt(entry.work.createdAt)} · {entry.placements.length}件の{vocabulary.occurrence}</small>
				</button>
				{#if entry.placements.length > 1}
					<p class="hint">{placementSummary(entry)}</p>
				{/if}
			{:else}
				<p class="empty">この期間に作成した{vocabulary.work}はありません。</p>
			{/each}
		</section>
		<section aria-label="この期間に更新">
			<h2>
				この期間に更新 <small>{filteredUpdated.length}件{#if filteredUpdated.length !== projection.updated.length} / {projection.updated.length}件{/if}</small>
			</h2>
			{#each filteredUpdated as entry (entry.work.id)}
				<button class="date-entry" onclick={() => onOpenEntry(entry)} disabled={!entry.representative}>
					<strong>{entry.representative ? titleFor(entry.representative) : `(未配置の${vocabulary.work})`}</strong>
					<small>{formatCreatedAt(entry.work.updatedAt)} · {entry.placements.length}件の{vocabulary.occurrence}</small>
				</button>
				{#if entry.placements.length > 1}
					<p class="hint">{placementSummary(entry)}</p>
				{/if}
			{:else}
				<p class="empty">この期間に更新した既存{vocabulary.work}はありません。</p>
			{/each}
		</section>
	{/if}
</section>

<style>
	.date-projection {
		display: grid;
		gap: 18px;
	}
	.date-projection > :global(.section-title) {
		margin-bottom: 0;
	}
	.date-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.date-controls label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--muted);
	}
	.date-controls input[type="date"] {
		padding: 4px 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-size: 11px;
	}
	.date-projection section {
		display: grid;
		gap: 6px;
	}
	.date-projection h2 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin: 0 0 4px;
		color: var(--text);
		font-size: 18px;
	}
	.date-projection h2 small {
		color: var(--muted);
		font-size: 11px;
		font-weight: normal;
	}
	.date-entry {
		display: grid;
		width: 100%;
		gap: 4px;
		padding: 9px 11px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-raised) !important;
		color: var(--text) !important;
		text-align: left;
		line-height: 1.35;
		cursor: pointer;
	}
	.date-entry:hover,
	.date-entry:focus-visible {
		border-color: var(--cyan);
		background: var(--surface-hover) !important;
		outline: none;
	}
	.date-entry:disabled {
		opacity: .7;
		cursor: not-allowed;
	}
	.date-entry strong {
		color: var(--text);
		font-size: 12px;
		font-weight: normal;
	}
	.date-entry small {
		color: var(--muted);
		font-size: 10px;
	}
	.date-projection section > :global(.hint) {
		margin: 0;
	}
</style>
