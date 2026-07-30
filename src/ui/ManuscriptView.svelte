<script lang="ts">
	import type { ManuscriptSection } from "../services/manuscript_projection.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import { measureManuscript } from "./manuscript_metrics.ts";

	type ManuscriptVocabulary = Pick<UiVocabulary, "work"> & {
		manuscript: string;
		manuscriptTotalCount: string;
		manuscriptBranchCount: string;
		manuscriptReadOnly: string;
	};

	let {
		sections,
		vocabulary,
		onSelect,
		onChange,
		onInternalReference,
	}: {
		sections: ManuscriptSection[];
		vocabulary: ManuscriptVocabulary;
		onSelect: (occurrenceId: string) => void;
		onChange: (section: ManuscriptSection, text: string, textarea: HTMLTextAreaElement) => void;
		onInternalReference: (destination: string) => void;
	} = $props();

	const metrics = $derived(measureManuscript(sections));

	function leaveNativeEditingUntouched(
		_event: KeyboardEvent,
		_textarea: HTMLTextAreaElement,
		_compositionGuard: boolean,
	): void {}
</script>

<section class="manuscript-view" aria-label={vocabulary.manuscript}>
	<header class="manuscript-summary">
		<h1>{vocabulary.manuscript}</h1>
		<p>{vocabulary.manuscriptTotalCount}: {metrics.totalCharacterCount}</p>
		<ul aria-label={vocabulary.manuscriptBranchCount}>
			{#each metrics.branches as branch (branch.occurrenceId)}
				<li style:--manuscript-depth={branch.depth}>
					<span>{branch.heading}</span>
					<small>{vocabulary.manuscriptBranchCount}: {branch.characterCount}</small>
				</li>
			{/each}
		</ul>
	</header>

	<div class="manuscript-sections">
		{#each sections as section (section.occurrenceId)}
			<article
				class="manuscript-section"
				style:--manuscript-depth={section.depth}
			>
				<svelte:element this={`h${Math.min(section.depth + 2, 6)}`}>
					<button type="button" onclick={() => onSelect(section.occurrenceId)}>
						{section.heading}
					</button>
				</svelte:element>
				{#if section.revisionSelector.mode === "branch"}
					<MarkdownEditor
						value={section.text}
						itemId={section.occurrenceId}
						onFocus={() => onSelect(section.occurrenceId)}
						onChange={(text, textarea) => onChange(section, text, textarea)}
						onKeydown={leaveNativeEditingUntouched}
						onInternalReference={onInternalReference}
					/>
				{:else}
					<p class="manuscript-read-only">{vocabulary.manuscriptReadOnly}</p>
					<pre>{section.text}</pre>
				{/if}
			</article>
		{:else}
			<p class="manuscript-empty">{vocabulary.work}はありません。</p>
		{/each}
	</div>
</section>

<style>
	.manuscript-view { min-width: 0; padding: 1.5rem; overflow: auto; }
	.manuscript-summary { border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
	.manuscript-summary h1 { margin: 0; }
	.manuscript-summary ul { display: grid; gap: .25rem; padding: 0 0 .75rem; list-style: none; }
	.manuscript-summary li { display: flex; justify-content: space-between; gap: .75rem; padding-left: calc(var(--manuscript-depth) * .75rem); }
	.manuscript-section { padding: 1rem 0 1rem calc(var(--manuscript-depth) * 1rem); border-bottom: 1px solid var(--border); }
	.manuscript-section h2 button,
	.manuscript-section h3 button,
	.manuscript-section h4 button,
	.manuscript-section h5 button,
	.manuscript-section h6 button { color: inherit; font: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
	.manuscript-section :global(.markdown-editor) { margin-top: .75rem; }
	.manuscript-read-only { color: var(--muted); font-size: .85rem; }
	.manuscript-section pre { white-space: pre-wrap; font: inherit; }
	.manuscript-empty { color: var(--muted); }
</style>
