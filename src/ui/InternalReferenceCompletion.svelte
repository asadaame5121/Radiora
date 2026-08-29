<script lang="ts">
	import ReferenceCandidateList from "./ReferenceCandidateList.svelte";
	import type { InternalReferenceCompletionState } from "./editor_controller.svelte.ts";
	import type { InternalReferenceCompletion } from "../services/internal_reference_service.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";

	let {
		completion,
		vocabulary,
		onSelect,
	}: {
		completion: InternalReferenceCompletionState;
		vocabulary: UiVocabulary;
		onSelect: (candidate: InternalReferenceCompletion) => void;
	} = $props();
</script>

<div class="internal-reference-completions" role="listbox" aria-label={`${vocabulary.internalReference}候補`}>
	{#if completion.candidates.length}
		<ReferenceCandidateList
			candidates={completion.candidates}
			activeIndex={completion.activeIndex}
			{onSelect}
		/>
	{:else}
		<p>一致する候補はありません。</p>
	{/if}
</div>

<style>
	.internal-reference-completions {
		position: absolute;
		z-index: 20;
		inset: 100% 0 auto 0;
		max-height: 240px;
		overflow: auto;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		box-shadow: 0 12px 28px rgb(0 0 0 / 24%);
	}
	.internal-reference-completions p {
		margin: 6px 8px;
		color: var(--muted);
		font-size: 12px;
	}
</style>
