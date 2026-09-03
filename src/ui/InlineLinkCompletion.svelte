<script lang="ts">
	import type { LinkType, RelationTypeDefinition } from "../domain/models.ts";
	import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";
	import { previewDirection } from "../services/advanced_link_resolver.ts";
	import ReferenceCandidateList from "./ReferenceCandidateList.svelte";
	import type {
		InlineLinkCompletionState,
		InlineLinkDirection,
	} from "./editor_controller.svelte.ts";
	import type { InternalReferenceCompletion } from "../services/internal_reference_service.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";

	let {
		completion,
		itemTitle,
		vocabulary,
		relationTypeDefinitions,
		onSearch,
		onKeydown,
		onSelectCandidate,
		onCreateTarget,
		onSelectType,
		onSetDirection,
		onCommit,
	}: {
		completion: InlineLinkCompletionState;
		itemTitle: string;
		vocabulary: UiVocabulary;
		relationTypeDefinitions?: readonly RelationTypeDefinition[];
		onSearch: (query: string) => void;
		onKeydown: (event: KeyboardEvent) => void;
		onSelectCandidate: (candidate: InternalReferenceCompletion) => void;
		onCreateTarget: () => void;
		onSelectType: (type: LinkType) => void;
		onSetDirection: (direction: InlineLinkDirection) => void;
		onCommit: () => void;
	} = $props();

	const definitions = $derived(relationTypeDefinitions ?? BUILT_IN_RELATION_TYPES);
	const definitionMap = $derived(new Map(definitions.map((def) => [def.name, def])));
	const selectedDefinition = $derived(
		completion.selectedType ? definitionMap.get(completion.selectedType) : undefined,
	);
</script>

<div class="inline-link-completions inline-link-omniwindow" role="dialog"
	aria-label={`@${vocabulary.semanticLink}先を検索`}>
	<div class="inline-link-omniwindow__search">
		<span aria-hidden="true">@</span>
		<input
			value={completion.query}
			placeholder={`${vocabulary.work}を検索…`}
			aria-label={`@${vocabulary.semanticLink}先を検索`}
			readonly={completion.phase !== "candidate"}
			disabled={completion.creating}
			oninput={(event) => onSearch(event.currentTarget.value)}
			onkeydown={onKeydown}
			onmousedown={(event) => event.stopPropagation()}
		/>
	</div>
	<div class="inline-link-omniwindow__body">
		{#if completion.phase === "candidate"}
			<p class="inline-link-completions__hint" aria-live="polite">
				{completion.searching ? "検索中…" : `@${vocabulary.semanticLink}先を検索`}
			</p>
			<div role="listbox" aria-label={`${vocabulary.work}候補`}>
				<ReferenceCandidateList
					candidates={completion.candidates}
					activeIndex={completion.activeIndex}
					onSelect={onSelectCandidate}
				/>
				{#if !completion.searching && completion.query.trim()}
					<button
						type="button"
						class="create-candidate"
						class:active={completion.activeIndex === completion.candidates.length}
						role="option"
						aria-selected={completion.activeIndex === completion.candidates.length}
						disabled={completion.creating}
						onmousedown={(event) => event.preventDefault()}
						onclick={onCreateTarget}
					>
						<strong>「{completion.query.trim()}」を新規作成</strong>
						<span>{vocabulary.unplacedInbox} · Shift+Enter</span>
					</button>
				{/if}
			</div>
			{#if !completion.searching && !completion.candidates.length}
				<p>一致する{vocabulary.work}はありません。</p>
			{:else if !completion.searching && completion.query.trim()}
				<p class="inline-link-completions__hint">候補から選択するか、Shift+Enterで新規作成できます。</p>
			{/if}
		{:else if completion.selectedCandidate}
			<div class="inline-link-completions__target">
				<strong>@{completion.selectedCandidate.displayName}</strong>
				<span>{vocabulary.linkType}を選択</span>
			</div>
			{#if completion.phase === "type"}
				<section class="inline-link-types" aria-label={vocabulary.linkType}>
					{#each definitions as def (def.name)}
						<button
							type="button"
							class:active={completion.selectedType === def.name}
							onmousedown={(event) => event.preventDefault()}
							onclick={() => onSelectType(def.name)}
						>{def.name}</button>
					{/each}
				</section>
			{:else}
				<section class="inline-link-direction" aria-label={`${vocabulary.semanticLink}方向`}>
					<button
						type="button"
						class:active={completion.direction === "forward"}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => onSetDirection("forward")}
					>{itemTitle} → {completion.selectedCandidate.displayName}</button>
					<button
						type="button"
						class:active={completion.direction === "reverse"}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => onSetDirection("reverse")}
					>{completion.selectedCandidate.displayName} → {itemTitle}</button>
				</section>
				<p class="inline-link-preview" role="status">
					{completion.direction === "forward"
						? previewDirection(
							itemTitle,
							completion.selectedType ?? "RELATED",
							completion.selectedCandidate.displayName,
							selectedDefinition?.direction,
						)
						: previewDirection(
							completion.selectedCandidate.displayName,
							completion.selectedType ?? "RELATED",
							itemTitle,
							selectedDefinition?.direction,
						)}
				</p>
				<button type="button" onclick={onCommit}>この方向で{vocabulary.semanticLink}</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.inline-link-completions {
		position: absolute;
		z-index: 21;
		inset: 100% 0 auto 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 5px;
		max-height: 300px;
		overflow: auto;
		padding: 6px;
		border: 1px solid var(--cyan);
		border-radius: 8px;
		background: var(--surface-raised);
		box-shadow: 0 12px 28px rgb(0 0 0 / 28%);
	}
	.inline-link-omniwindow {
		padding: 0;
		overflow: hidden;
	}
	.inline-link-omniwindow__search {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--border);
		background: var(--theme-surface, #04080d);
		color: var(--cyan);
	}
	.inline-link-omniwindow__search > span {
		font-weight: 700;
	}
	.inline-link-omniwindow__search input {
		width: 100%;
		min-width: 0;
		border: 0;
		border-radius: 0;
		padding: 3px 0;
		background: transparent;
		color: var(--text);
		outline: none;
	}
	.inline-link-omniwindow__search input:focus {
		border-color: transparent;
		box-shadow: none;
	}
	.inline-link-omniwindow__body {
		max-height: 270px;
		overflow: auto;
		padding: 4px;
	}
	.inline-link-omniwindow__body [role="listbox"] {
		display: grid;
		gap: 3px;
	}
	.inline-link-completions__hint,
	.inline-link-completions__target,
	.inline-link-preview {
		margin: 0;
		color: var(--muted);
		font-size: 10px;
	}
	.inline-link-completions__target {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 3px 4px 5px;
		border-bottom: 1px solid var(--border);
	}
	.inline-link-completions__target strong {
		color: var(--cyan-soft);
	}
	.inline-link-completions button {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-width: 0;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: var(--surface) !important;
		color: var(--text) !important;
		text-align: left;
		font-size: 11px;
		cursor: pointer;
	}
	.inline-link-completions button:hover,
	.inline-link-completions button.active {
		border-color: var(--cyan);
		background: var(--surface-hover);
	}
	.inline-link-completions button span {
		margin-left: auto;
		color: var(--muted);
		font-size: 10px;
		white-space: nowrap;
	}
	.create-candidate {
		color: var(--cyan-soft);
	}
	.inline-link-types,
	.inline-link-direction {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
		gap: 4px;
	}
	.inline-link-types button,
	.inline-link-direction button {
		text-align: center;
	}
	.inline-link-preview {
		padding: 5px 6px;
		border-left: 2px solid var(--cyan);
		background: var(--surface-hover);
		line-height: 1.4;
	}
</style>
