<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import type { OutlineItem, RelationTypeDefinition } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type { VisibleRow } from "./outline_view_model.ts";
	import type {
		InlineLinkCompletionState,
		InternalReferenceCompletionState,
	} from "./editor_completion_controller.svelte.ts";
	import type { OutlineHelpers, OutlineRowHandlers } from "./outline_row_types.ts";
	import OutlineRowItem from "./OutlineRowItem.svelte";
	import { OUTLINE_PIXEL_TOLERANCE, type VirtualOutlineEntry } from "./virtual_outline_viewport.ts";
	import type { OutlineVirtualViewportController } from "./outline_virtual_viewport_controller.svelte.ts";
	import {
		type EnsureOutlineRowMounted,
		OutlineViewportAdapter,
	} from "./outline_viewport_adapter.ts";

	let {
		viewport,
		draggedId,
		onDragStart,
		onDragEnd,
		outlineContextBreadcrumb,
		outlineContextBreadcrumbItems,
		outlineContextTitle,
		registerEnsureMounted = () => () => undefined,
		hoisted,
		canClearHoist,
		clearHoistReason,
		onClearHoist,
		visibleRows,
		vocabulary,
		loading,
		hasSnapshot = false,
		snapshotItemsLength,
		selectedId,
		internalReferenceCompletion,
		inlineLinkCompletion,
		relationTypeDefinitions,
		stashItemIdsLength,
		knotsLength,
		openBreadcrumb,
		createRoot,
		handlers,
		helpers,
	}: {
		viewport: OutlineVirtualViewportController;
		draggedId: string | null;
		onDragStart: (id: string) => void;
		onDragEnd: () => void;
		outlineContextBreadcrumb: string;
		outlineContextBreadcrumbItems: readonly OutlineItem[];
		outlineContextTitle: string;
		registerEnsureMounted?: (port: EnsureOutlineRowMounted) => () => void;
		hoisted: boolean;
		canClearHoist: boolean;
		clearHoistReason: string | undefined;
		onClearHoist: () => void;
		visibleRows: readonly VisibleRow[];
		vocabulary: UiVocabulary;
		loading: boolean;
		hasSnapshot?: boolean;
		snapshotItemsLength: number;
		selectedId: string | null;
		internalReferenceCompletion: InternalReferenceCompletionState | null;
		inlineLinkCompletion: InlineLinkCompletionState | null;
		relationTypeDefinitions?: readonly RelationTypeDefinition[];
		stashItemIdsLength: number;
		knotsLength: number;
		openBreadcrumb: (id: string) => void;
		createRoot: () => void;
		handlers: OutlineRowHandlers;
		helpers: OutlineHelpers;
	} = $props();

	let rowsEl = $state<HTMLDivElement | null>(null);
	const viewportAdapter = new OutlineViewportAdapter();
	const rowElements = new Map<string, HTMLElement>();
	const rowIdsByElement = new WeakMap<Element, string>();
	let anchorFrame = 0;
	const rowObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
		let changed = false;
		for (const entry of entries) {
			const id = rowIdsByElement.get(entry.target);
			const height = entry.borderBoxSize?.[0]?.blockSize ??
				entry.target.getBoundingClientRect().height;
			if (id && viewport.reportHeight(id, height)) changed = true;
		}
		if (changed) scheduleAnchorAdjustment();
	});

	const normalRows = $derived.by(() => visibleRows.filter((row) => !row.stash));
	const stashRows = $derived.by(() => visibleRows.filter((row) => row.stash));
	const virtualWindow = $derived(viewport.window);
	const renderedEntries = $derived.by(() =>
		virtualWindow.entries.map((entry: VirtualOutlineEntry) => ({
			...entry,
			row: normalRows[entry.index],
		}))
	);

	$effect.pre(() => {
		const ids = normalRows.map((row) => row.item.id);
		const protectedIds = [selectedId, draggedId].filter((id): id is string => Boolean(id));
		untrack(() => {
			viewport.setRows(ids);
			viewport.setProtectedIds(protectedIds);
			scheduleAnchorAdjustment();
		});
	});

	$effect(() => {
		const element = rowsEl;
		if (!element) return;
		return untrack(() =>
			viewportAdapter.observeRows(element, (metrics) => {
				viewport.setMetrics(metrics);
				const visibleIds = viewport.window.entries.map((entry) => viewport.rowIds[entry.index]);
				if (viewport.setWidth(element.clientWidth, visibleIds)) scheduleAnchorAdjustment();
			})
		);
	});

	onMount(() => {
		const unregister = registerEnsureMounted(ensureMounted);
		return () => {
			unregister();
			viewport.releaseProtectedRows();
			if (anchorFrame) cancelAnimationFrame(anchorFrame);
			rowObserver?.disconnect();
			onDragEnd();
		};
	});

	function connectRowElement(id: string, element: HTMLElement | null): void {
		const previous = rowElements.get(id);
		if (previous && previous !== element) {
			rowObserver?.unobserve(previous);
			rowIdsByElement.delete(previous);
			rowElements.delete(id);
		}
		if (!element) return;
		rowElements.set(id, element);
		rowIdsByElement.set(element, id);
		rowObserver?.observe(element);
	}

	function scheduleAnchorAdjustment(): void {
		if (anchorFrame) cancelAnimationFrame(anchorFrame);
		anchorFrame = requestAnimationFrame(() => {
			anchorFrame = 0;
			const element = rowsEl;
			if (!element) return;
			const delta = viewport.takeAnchorAdjustment();
			if (Math.abs(delta) < OUTLINE_PIXEL_TOLERANCE) return;
			viewportAdapter.adjustScroll(element, delta);
			viewport.setMetrics({
				scrollTop: viewport.metrics.scrollTop + delta,
				viewportHeight: viewport.metrics.viewportHeight,
			});
		});
	}

	async function ensureMounted(id: string, current: () => boolean): Promise<boolean> {
		const element = rowsEl;
		if (!element || !current()) return false;
		const target = viewport.scrollTopFor(id);
		if (target === null) return false;
		const metrics = viewport.metrics;
		if (Math.abs(target - metrics.scrollTop) >= OUTLINE_PIXEL_TOLERANCE) {
			viewportAdapter.scrollToLogical(element, target);
			viewport.setMetrics({ scrollTop: target, viewportHeight: metrics.viewportHeight });
		}
		await tick();
		return current() && rowElements.has(id);
	}

	function handleRootDrop(event: DragEvent): void {
		viewportAdapter.dropOnVirtualGap(
			event,
			draggedId,
			rowsEl,
			viewport.layout,
			normalRows,
			(row) => handlers.dropOn(row.item),
		);
	}
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
			{normalRows.length}件の{vocabulary.work} · 行をそのまま編集できます
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
	<p role="status">{hasSnapshot ? "更新中…" : "Loading…"}</p>
{/if}

{#if !loading || hasSnapshot}
	{#if snapshotItemsLength === 0}
		<button type="button" class="first-item"
	onclick={createRoot}>最初の{vocabulary.work}を作る</button>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
	bind:this={rowsEl}
	class="rows"
	role="tree"
	aria-busy={loading}
	aria-label={`${vocabulary.work}のアウトライン`}
	tabindex="0"
	onfocusin={(event) => viewport.trackFocusIn(event.target)}
	onfocusout={(event) => viewport.trackFocusOut(event.target, event.relatedTarget)}
	oncompositionstart={(event) => viewport.trackCompositionStart(event.target)}
	oncompositionend={(event) => viewport.trackCompositionEnd(event.target)}
	ondragover={(event) => {
				if (event.target === event.currentTarget || (event.target instanceof Element && event.target.closest(".virtual-gap"))) event.preventDefault();
			}}
	ondrop={handleRootDrop}
	onmousedown={(event) => {
				if (event.target === event.currentTarget) handlers.deselectFromBlank(event);
			}}
>
			{#each renderedEntries as entry (entry.row.item.id)}
				{#if entry.gapBefore > 0}
					<div class="virtual-gap" style:height={`${entry.gapBefore}px`} aria-hidden="true" role="presentation"></div>
				{/if}
				<OutlineRowItem
					row={entry.row}
					{selectedId}
					{draggedId}
					{vocabulary}
					{internalReferenceCompletion}
					{inlineLinkCompletion}
					{relationTypeDefinitions}
					{handlers}
					{helpers}
					{onDragStart}
					{onDragEnd}
					onRowElement={connectRowElement}
				/>
			{/each}
			{#if virtualWindow.trailingGap > 0}
				<div class="virtual-gap" style:height={`${virtualWindow.trailingGap}px`} aria-hidden="true" role="presentation"></div>
			{/if}
		</div>
	{/if}

	{#if stashItemIdsLength}
		<div
	class="section-title stash-title"><span>Stash / Knots</span><small>{knotsLength} knot</small></div>
		<div class="stash-list">
			{#each stashRows as row (row.item.id)}
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
		color: var(--theme-text, #edf9fa);
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
		color: var(--theme-muted, #9aaeb7);
	}
	.outline-actions {
		flex: none;
		margin: 0;
		gap: 6px;
		letter-spacing: .08em;
	}
	.rows {
		max-width: 820px;
		overflow-anchor: none;
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
		color: var(--theme-red, #dd8d84);
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
