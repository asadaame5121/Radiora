<script lang="ts">
	import type { InternalReferenceCompletion } from "../services/internal_reference_service.ts";

	let {
		candidates,
		activeIndex,
		onSelect,
	}: {
		candidates: readonly InternalReferenceCompletion[];
		activeIndex: number;
		onSelect: (candidate: InternalReferenceCompletion) => void;
	} = $props();
</script>

{#each candidates as candidate, index (candidate.scope + candidate.id)}
	<button
		type="button"
		class:active={index === activeIndex}
		role="option"
		aria-selected={index === activeIndex}
		onmousedown={(event) => event.preventDefault()}
		onclick={() => onSelect(candidate)}
	>
		<strong>{candidate.displayName}</strong>
		<span>{candidate.scopeLabel} · {candidate.shortId}</span>
	</button>
{/each}

<style>
	button {
		display: flex;
		width: 100%;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 9px;
		border: 0;
		border-radius: 5px;
		color: var(--text);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	button:hover,
	button.active {
		background: var(--surface-hover);
	}
	span {
		color: var(--muted);
		font-size: 11px;
		white-space: nowrap;
	}
</style>
