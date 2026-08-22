<script lang="ts">
	import type { OutlineItem } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type { VisibleRow } from "./outline_view_model.ts";
	import type {
		InlineLinkCompletionState,
		InternalReferenceCompletionState,
	} from "./editor_controller.svelte.ts";
	import type {
		OutlineHelpers,
		OutlineRowHandlers,
	} from "./outline_row_types.ts";
	import OutlineRowItem from "./OutlineRowItem.svelte";

	let {
		outlineContextBreadcrumb,
		outlineContextBreadcrumbItems,
		outlineContextTitle,
		hoisted,
		canClearHoist,
		clearHoistReason,
		onClearHoist,
		visibleRows,
		vocabulary,
		loading,
		snapshotItemsLength,
		selectedId,
		internalReferenceCompletion,
		inlineLinkCompletion,
		stashItemIdsLength,
		knotsLength,
		openBreadcrumb,
		createRoot,
		handlers,
		helpers,
	}: {
		outlineContextBreadcrumb: string;
		outlineContextBreadcrumbItems: readonly OutlineItem[];
		outlineContextTitle: string;
		hoisted: boolean;
		canClearHoist: boolean;
		clearHoistReason: string | undefined;
		onClearHoist: () => void;
		visibleRows: readonly VisibleRow[];
		vocabulary: UiVocabulary;
		loading: boolean;
		snapshotItemsLength: number;
		selectedId: string | null;
		internalReferenceCompletion: InternalReferenceCompletionState | null;
		inlineLinkCompletion: InlineLinkCompletionState | null;
		stashItemIdsLength: number;
		knotsLength: number;
		openBreadcrumb: (id: string) => void;
		createRoot: () => void;
		handlers: OutlineRowHandlers;
		helpers: OutlineHelpers;
	} = $props();

	let draggedId = $state<string | null>(null);
</script>

<div class="outline-context">
	<div>
		{#if outlineContextBreadcrumb}
			<nav class="outline-context__breadcrumb" aria-label={vocabulary.breadcrumb}>
				{#each outlineContextBreadcrumbItems as ancestor (ancestor.id)}
					<button type="button" onclick={() => openBreadcrumb(ancestor.id)}>{helpers.titleFor(ancestor)}</button>
					<span aria-hidden="true">›</span>
				{/each}
			</nav>
		{/if}
		<h1>{outlineContextTitle}</h1>
		<p class="outline-context__meta">
			{visibleRows.filter((row) => !row.stash).length}件の{vocabulary.work} · 行をそのまま編集できます
		</p>
	</div>
	<div class="section-title outline-actions">
		{#if hoisted}
			<button type="button" onclick={onClearHoist} disabled={!canClearHoist} title={clearHoistReason}>{vocabulary.hoist}を解除</button>
		{/if}
		<button type="button" onclick={createRoot}>＋ ルートに追加</button>
	</div>
</div>

{#if loading}
	<p class="empty">Loading…</p>
{:else if snapshotItemsLength === 0}
	<button type="button" class="first-item" onclick={createRoot}>最初の{vocabulary.work}を作る</button>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="rows"
		role="tree"
		aria-label={`${vocabulary.work}のアウトライン`}
		tabindex="0"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) handlers.deselectFromBlank(event);
		}}
	>
		{#each visibleRows.filter((row) => !row.stash) as row (row.item.id)}
			<OutlineRowItem
				{row}
				{selectedId}
				{draggedId}
				{vocabulary}
				{internalReferenceCompletion}
				{inlineLinkCompletion}
				{handlers}
				{helpers}
				onDragStart={(id) => (draggedId = id)}
				onDragEnd={() => (draggedId = null)}
			/>
		{/each}
	</div>
{/if}

{#if stashItemIdsLength}
	<div class="section-title stash-title"><span>Stash / Knots</span><small>{knotsLength} knot</small></div>
	<div class="stash-list">
		{#each visibleRows.filter((row) => row.stash) as row (row.item.id)}
			<button
				type="button"
				class:selected={selectedId === row.item.id}
				onclick={() => handlers.selectOccurrence(row.item.id)}
			>
				<span>∞</span>{row.item.text || `(空の${vocabulary.work})`}
			</button>
		{/each}
	</div>
{/if}

<style>
	.outline-context {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 18px;
		margin-bottom: 18px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--border);
	}
	.outline-context h1 {
		max-width: min(760px, 70vw);
		margin: 3px 0 4px;
		font-family: var(--font-serif);
		font-size: clamp(20px, 2.5vw, 30px);
		font-weight: normal;
		line-height: 1.25;
		color: #edf9fa;
		word-break: break-word;
	}
	.outline-context__breadcrumb,
	.outline-context__meta {
		margin: 0;
		color: var(--muted);
		font-size: 10px;
	}
	.outline-context__breadcrumb {
		display: flex;
		align-items: center;
		gap: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.outline-context__breadcrumb button {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--cyan-soft);
		font-size: inherit;
	}
	.outline-context__breadcrumb button:hover {
		border-color: transparent;
		background: transparent;
		color: var(--text);
	}
	.outline-context__meta {
		color: #9aaeb7;
	}
	.outline-actions {
		flex: none;
		margin: 0;
		gap: 6px;
		letter-spacing: .08em;
	}
	.rows {
		max-width: 820px;
	}
	.first-item {
		margin: 80px auto;
		display: block;
		border: 1px dashed var(--border-bright);
		background: transparent;
		color: var(--muted);
		padding: 16px 24px;
		border-radius: 10px;
		cursor: pointer;
	}
	.stash-title {
		margin-top: 42px;
		border-top: 1px solid var(--border);
		padding-top: 18px;
		color: #dd8d84;
	}
	.stash-title small {
		letter-spacing: normal;
	}
	.stash-list {
		display: grid;
		gap: 4px;
	}
	.stash-list button {
		border: 1px solid #5a2934;
		background: #1c1018;
		color: #e3aab2;
		padding: 8px 10px;
		border-radius: 5px;
		text-align: left;
		cursor: pointer;
	}
	.stash-list button span {
		margin-right: 8px;
		color: var(--red);
	}
</style>
