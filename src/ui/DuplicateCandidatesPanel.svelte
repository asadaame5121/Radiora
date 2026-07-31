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

<section class="outline-panel" aria-label={vocabulary.duplicateCandidates}>
	<div class="section-title">
		<span>{vocabulary.duplicateCandidates}</span><small>{candidates.length}件</small>
	</div>
	<p class="hint">{vocabulary.duplicateCandidateHint}</p>
	<div class="unplaced-list">
		{#each candidates as candidate (`${candidate.workA.workId}:${candidate.workB.workId}`)}
			<article class="unplaced-entry">
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
				<div class="unplaced-actions" aria-label={vocabulary.duplicateCandidateActions}>
					<details>
						<summary>{vocabulary.duplicateMerge}</summary>
						<button
							onclick={() => onRequestMerge(candidate.workB.workId, candidate.workA.workId)}
						>{vocabulary.duplicateKeepLeft}</button>
						<button
							onclick={() => onRequestMerge(candidate.workA.workId, candidate.workB.workId)}
						>{vocabulary.duplicateKeepRight}</button>
					</details>
					<button onclick={() => onCreateLink(candidate, "LIKE")}>{vocabulary.duplicateCreateLike}</button>
					<button onclick={() => onCreateLink(candidate, "RELATED")}>{vocabulary.duplicateCreateRelated}</button>
					<button onclick={() => onDismiss(candidate)}>{vocabulary.duplicateDismiss}</button>
				</div>
			</article>
		{:else}
			<p class="empty">{vocabulary.duplicateCandidates}はありません。</p>
		{/each}
	</div>
</section>
