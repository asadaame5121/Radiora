<script lang="ts">
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
	import IconButton from "./primitives/IconButton.svelte";
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import InternalReferenceCompletion from "./InternalReferenceCompletion.svelte";
	import InlineLinkCompletion from "./InlineLinkCompletion.svelte";

	let {
		row,
		selectedId,
		draggedId,
		vocabulary,
		internalReferenceCompletion,
		inlineLinkCompletion,
		handlers,
		helpers,
		onDragStart,
		onDragEnd,
	}: {
		row: VisibleRow;
		selectedId: string | null;
		draggedId: string | null;
		vocabulary: UiVocabulary;
		internalReferenceCompletion: InternalReferenceCompletionState | null;
		inlineLinkCompletion: InlineLinkCompletionState | null;
		handlers: OutlineRowHandlers;
		helpers: OutlineHelpers;
		onDragStart: (id: string) => void;
		onDragEnd: () => void;
	} = $props();

	const REFERENCE_PREFIX_LENGTH = 8;

	const inlineLinks = $derived(helpers.inlineSemanticLinksFor(row.item.text));
	const annotations = $derived(helpers.semanticLinkAnnotationsFor(row.item.id));
	const rowBody = $derived(helpers.bodyFor(row.item));
</script>

<div
	class:selected={selectedId === row.item.id}
	class:dragging={draggedId === row.item.id}
	class="row"
	style={`--depth:${row.depth}`}
	role="treeitem"
	aria-selected={selectedId === row.item.id}
	tabindex="-1"
	oncontextmenu={(event) => handlers.openOccurrenceContextMenu(row.item.id, "outline", event)}
	onkeydown={(event) => handlers.handleOccurrenceContextMenuKeydown(row.item.id, "outline", event)}
	draggable="true"
	ondragstart={() => onDragStart(row.item.id)}
	ondragend={onDragEnd}
	onmousedown={(event) => {
		if (event.target === event.currentTarget) handlers.deselectFromBlank(event);
	}}
	ondragover={(event) => event.preventDefault()}
	ondrop={() => handlers.dropOn(row.item)}
>
	<IconButton
		class={`disclosure${row.hasChildren ? "" : " hidden"}`}
		label={row.item.collapsed ? `${helpers.titleFor(row.item)}を展開` : `${helpers.titleFor(row.item)}を折りたたむ`}
		onclick={() => handlers.toggle(row)}
	>{row.item.collapsed ? "›" : "⌄"}</IconButton>
	{#if row.item.referenceStub}<span class="reference-stub" title="再帰参照">↩</span>{/if}
	<button
		type="button"
		class="bullet"
		aria-label={`${vocabulary.work}を選択`}
		title={`ダブルクリックでこの${vocabulary.work}へZoom`}
		onclick={() => handlers.selectOccurrence(row.item.id)}
		ondblclick={() => handlers.hoistOccurrence(row.item.id)}
	>•</button>
	<div class="internal-reference-editor">
		<MarkdownEditor
			value={row.item.text}
			itemId={row.item.id}
			onFocus={() => handlers.selectOccurrence(row.item.id)}
			onChange={(_value, textarea) => handlers.updateLocalText(row.item.id, textarea)}
			onSelectionChange={(textarea) => handlers.updateEditorSelection(row.item.id, textarea)}
			onKeydown={(event, textarea, compositionGuard) =>
				handlers.handleKeydown(event, row, textarea, compositionGuard)}
			onInternalReference={handlers.openEditorInternalReference}
		/>
		{#if rowBody && selectedId !== row.item.id}
			<p class="row-body-preview">{rowBody.replace(/\s+/gu, " ").trim()}</p>
		{/if}
		{#if internalReferenceCompletion && internalReferenceCompletion.itemId === row.item.id}
			<InternalReferenceCompletion
				completion={internalReferenceCompletion}
				{vocabulary}
				onSelect={(candidate) => handlers.applyInternalReferenceCompletion(row.item.id, candidate)}
			/>
		{/if}
		{#if inlineLinkCompletion && inlineLinkCompletion.itemId === row.item.id}
			<InlineLinkCompletion
				completion={inlineLinkCompletion}
				itemTitle={helpers.titleFor(row.item)}
				{vocabulary}
				onSearch={(query) => void handlers.updateInlineLinkSearch(row.item.id, query)}
				onKeydown={(event) => handlers.handleInlineLinkOmniKeydown(event, row.item.id)}
				onSelectCandidate={(candidate) => handlers.selectInlineLinkCandidate(row.item.id, candidate)}
				onCreateTarget={() => void handlers.createInlineLinkTarget(row.item.id)}
				onSelectType={(type) => handlers.selectInlineLinkType(row.item.id, type)}
				onSetDirection={(direction) => handlers.setInlineLinkDirection(row.item.id, direction)}
				onCommit={() => void handlers.commitInlineLink(row.item.id)}
			/>
		{/if}
		{#if helpers.referencesIn(row.item.text).length}
			<section class="internal-reference-chips" aria-label={vocabulary.internalReference}>
				{#each helpers.referencesIn(row.item.text) as reference (reference.range.start)}
					<button
						type="button"
						onclick={() => handlers.openInternalReference(
							row.item.text,
							reference.scope,
							reference.id,
							reference.range.start,
						)}
					>
						{reference.scope === "work" ? vocabulary.work : vocabulary.revision}
						· {reference.id.slice(0, REFERENCE_PREFIX_LENGTH)}
					</button>
				{/each}
			</section>
		{/if}
		{#if inlineLinks.candidates.length || inlineLinks.diagnostics.length}
			<section class="inline-semantic-links" aria-label="本文中の関係候補">
				{#each inlineLinks.candidates as candidate (candidate.start)}
					<button type="button" class="inline-candidate-btn" onclick={() => void handlers.inspectInlineSemanticLink(candidate)}>
						<span>{candidate.source} · {candidate.type} · {candidate.target}</span>
						{#if candidate.reason}<small>「{candidate.reason}」</small>{/if}
					</button>
				{/each}
				{#each inlineLinks.diagnostics as diagnostic (diagnostic.start)}
					<p class="inline-semantic-link-error" role="status">{diagnostic.message}</p>
				{/each}
			</section>
		{/if}
		{#if annotations.length}
			<section class="semantic-link-annotations" aria-label="関係注釈">
				{#each annotations as annotation (annotation.linkId)}
					<p>
						<span aria-hidden="true">┄ {helpers.annotationDirection(annotation)}</span>
						<strong>{annotation.type}</strong>
						<span>{annotation.otherDisplayName}</span>
						<small>「{annotation.reason}」</small>
					</p>
				{/each}
			</section>
		{/if}
	</div>
</div>

<style>
	.row {
		--indent: calc(var(--depth) * 24px);
		position: relative;
		display: grid;
		grid-template-columns: 22px 20px 1fr 26px;
		align-items: start;
		padding: 3px 4px 3px var(--indent);
		border-radius: 5px;
	}
	.row:hover,
	.row.selected {
		background: var(--surface-hover);
	}
	.row.selected {
		background: rgb(37 198 209 / 7%);
		box-shadow: inset 2px 0 var(--cyan);
	}
	.row:focus-within {
		background: var(--surface-hover);
		outline: 1px solid var(--border-bright);
		outline-offset: -1px;
	}
	.row.dragging {
		opacity: .5;
		box-shadow: inset 2px 0 var(--amber);
	}
	.internal-reference-editor {
		position: relative;
		min-width: 0;
	}
	.row-body-preview {
		margin: 2px 0 0;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.internal-reference-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 0 4px 4px;
	}
	.internal-reference-chips button {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 2px 7px;
		color: var(--cyan);
		background: var(--surface-raised);
		font-size: 10px;
		cursor: pointer;
	}
	.inline-semantic-links {
		display: grid;
		gap: 4px;
		margin: 4px 4px 0;
	}
	.inline-semantic-links .inline-candidate-btn {
		display: flex;
		flex-direction: column;
		width: 100%;
		gap: 2px;
		padding: 5px 7px;
		background: var(--surface-raised);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 5px;
		text-align: left;
		font-size: 10px;
		cursor: pointer;
	}
	.inline-semantic-links .inline-candidate-btn:hover {
		border-color: var(--cyan);
		background: var(--surface-hover);
	}
	.inline-semantic-links small,
	.inline-semantic-link-error {
		color: var(--muted);
		font-size: 10px;
	}
	.inline-semantic-link-error {
		margin: 0;
		padding: 6px 8px;
		border-left: 2px solid var(--amber);
		background: var(--surface-hover);
	}
	.semantic-link-annotations {
		display: grid;
		gap: 2px;
		margin: 4px 4px 0;
		padding-left: 8px;
		border-left: 1px dashed var(--border-bright);
	}
	.semantic-link-annotations p {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 5px;
		margin: 0;
		color: var(--muted);
		font-size: 10px;
		line-height: 1.5;
	}
	.semantic-link-annotations strong {
		color: var(--cyan-soft);
		font-size: 9px;
		font-weight: 600;
	}
	.semantic-link-annotations small {
		font-style: italic;
		color: #9aaeb7;
	}
	:global(.disclosure) {
		border: 0;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		padding: 5px;
		font-size: 18px;
		line-height: 20px;
	}
	:global(.disclosure.hidden) {
		visibility: hidden;
	}
	.reference-stub {
		color: var(--cyan);
		font-size: 0.75rem;
		line-height: 1;
	}
	.bullet {
		color: var(--cyan);
		padding: 4px 0 0;
		font-size: 20px;
		line-height: 20px;
		cursor: grab;
		border: 0;
		background: transparent;
	}
	.bullet:focus-visible {
		outline: 1px solid var(--cyan);
		border-radius: 4px;
	}
</style>
