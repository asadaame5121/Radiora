<script lang="ts">
	import type { OutlineItem } from "../domain/models.ts";
	import type { DateProjection, DateProjectionEntry } from "../services/date_projection.ts";
	import {
		matchesOutlineFilter,
		type OutlineFilter,
	} from "../services/outline_filter.ts";
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
	const filterActive = $derived(
		Boolean(outlineFilter.freeText || outlineFilter.tagsAll || outlineFilter.tagsNone),
	);

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
		<button onclick={onClearFilter} disabled={!filterActive}>解除</button>
	</div>
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
