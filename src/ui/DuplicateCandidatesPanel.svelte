<script lang="ts">
	import type { LinkType } from "../domain/models";
	import type { DuplicateCandidate } from "../services/duplicate_candidates";
	import type { UiVocabulary } from "../shared/ui_vocabulary";

	let {
		candidates,
		vocabulary,
		onRequestMerge,
		onCreateLink,
		onDismiss,
	}: {
		candidates: DuplicateCandidate[];
		vocabulary: UiVocabulary;
		onRequestMerge: (sourceWorkId: string, survivorWorkId: string) => void;
		onCreateLink: (candidate: DuplicateCandidate, type: Extract<LinkType, "LIKE" | "RELATED">) => void;
		onDismiss: (candidate: DuplicateCandidate) => void;
	} = $props();
</script>

<section class="outline-panel duplicate-panel" aria-label={vocabulary.duplicateCandidates}>
	<div class="section-title">
		<span>{vocabulary.duplicateCandidates}</span><small>{candidates.length}件</small>
	</div>
	<p class="hint">{vocabulary.duplicateCandidateHint}</p>
	<div class="candidate-list">
		{#each candidates as candidate (`${candidate.workA.workId}:${candidate.workB.workId}`)}
			<article class="candidate-card">
				<strong>
					{candidate.workA.title || `(空の${vocabulary.work})`}
					⇔ {candidate.workB.title || `(空の${vocabulary.work})`}
				</strong>
				<small>{vocabulary.duplicateScore}: {candidate.score}</small>
				<ul aria-label={vocabulary.duplicateReason}>
					{#each candidate.reasons as reason, index (index)}
						<li><small>{reason.label}(+{reason.score})</small></li>
					{/each}
				</ul>
				<div class="candidate-actions" aria-label={vocabulary.duplicateCandidateActions}>
					<details>
						<summary>{vocabulary.duplicateMerge}</summary>
						<button
							type="button"
							onclick={() => onRequestMerge(candidate.workB.workId, candidate.workA.workId)}
						>{vocabulary.duplicateKeepLeft}</button>
						<button
							type="button"
							onclick={() => onRequestMerge(candidate.workA.workId, candidate.workB.workId)}
						>{vocabulary.duplicateKeepRight}</button>
					</details>
					<button type="button" onclick={() => onCreateLink(candidate, "LIKE")}>{vocabulary.duplicateCreateLike}</button>
					<button type="button" onclick={() => onCreateLink(candidate, "RELATED")}>{vocabulary.duplicateCreateRelated}</button>
					<button type="button" onclick={() => onDismiss(candidate)}>{vocabulary.duplicateDismiss}</button>
				</div>
			</article>
		{:else}
			<p class="empty">{vocabulary.duplicateCandidates}はありません。</p>
		{/each}
	</div>
</section>

<style>
	.candidate-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-block-start: 12px;
	}
	.candidate-card {
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.candidate-card strong {
		color: var(--text);
		font-size: 13px;
	}
	.candidate-card small {
		color: var(--muted);
		font-size: 10px;
	}
	.candidate-card ul {
		margin: 0;
		padding-inline-start: 20px;
	}
	.candidate-actions {
		display: flex;
		flex-flow: row wrap;
		gap: 8px;
		align-items: center;
	}
	.candidate-actions details {
		display: inline-flex;
	}
	.candidate-actions summary,
	.candidate-actions button {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 5px 12px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 11px;
		line-height: 1.4;
		cursor: pointer;
	}
	.candidate-actions summary {
		list-style: none;
	}
</style>
