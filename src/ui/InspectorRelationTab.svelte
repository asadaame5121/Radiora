<script lang="ts">
	import type {
		CreateLinkInput,
		EmergenceSuggestion,
		OutlineItem,
		OutlineLink,
		SearchRequest,
		SearchResult,
	} from "../domain/models.ts";
	import type { InternalReferenceBacklink } from "../services/internal_reference_service.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import LinkEditor from "./LinkEditor.svelte";

	const PERCENT_SCALE = 100;

	export type InspectorRelationTabProps = {
		selectedItem: OutlineItem | null;
		selectedLinks: readonly OutlineLink[];
		vocabulary: UiVocabulary;
		inlineSemanticLinkNotice: string;
		internalReferenceBacklinks: readonly InternalReferenceBacklink[];
		internalReferenceNotice: string;
		emergenceSuggestions: readonly EmergenceSuggestion[];
		emergenceResolutionReasons: Readonly<Record<string, string>>;
		emergenceLoading: boolean;
		titleFor: (item: OutlineItem) => string;
		titleForId: (id: string) => string;
		titleForWork: (id: string) => string;
		onConfirmLink: (input: CreateLinkInput) => void | Promise<void>;
		onDeleteLink: (link: OutlineLink) => void | Promise<void>;
		onReverseLink: (link: OutlineLink) => void | Promise<void>;
		onCompareLink?: (link: OutlineLink) => void | Promise<void>;
		onSearch: (request: SearchRequest | string) => Promise<SearchResult[]>;
		onOpenBacklink: (backlink: InternalReferenceBacklink) => void | Promise<void>;
		onSetEmergenceReason: (id: string, value: string) => void;
		onResolveEmergence: (
			suggestion: EmergenceSuggestion,
			action: "accept" | "dismiss" | "pin",
		) => void | Promise<void>;
	};

	let {
		selectedItem,
		selectedLinks,
		vocabulary,
		inlineSemanticLinkNotice,
		internalReferenceBacklinks,
		internalReferenceNotice,
		emergenceSuggestions,
		emergenceResolutionReasons,
		emergenceLoading,
		titleFor,
		titleForId,
		titleForWork,
		onConfirmLink,
		onDeleteLink,
		onReverseLink,
		onCompareLink,
		onSearch,
		onOpenBacklink,
		onSetEmergenceReason,
		onResolveEmergence,
	}: InspectorRelationTabProps = $props();
</script>

{#if selectedItem}
	<div>
		<LinkEditor
			selectedWorkId={selectedItem.workId}
			selectedDisplayName={titleFor(selectedItem)}
			links={selectedLinks}
			titleForWork={titleForWork}
			onConfirm={onConfirmLink}
			onDelete={onDeleteLink}
			onReverse={onReverseLink}
			onCompare={onCompareLink}
			onSearch={onSearch}
		/>
		{#if inlineSemanticLinkNotice}<p class="inline-semantic-link-notice" role="status">{inlineSemanticLinkNotice}</p>{/if}
		<section class="internal-reference-backlinks">
			<h3>{vocabulary.backlink}<small>{internalReferenceBacklinks.length}件</small></h3>
			{#each internalReferenceBacklinks as backlink (JSON.stringify(backlink.source))}
				<button type="button" class="backlink-entry" onclick={() => void onOpenBacklink(backlink)}>
					<strong>{backlink.displayName}</strong>
					<span>{backlink.source.scope === "work" ? vocabulary.workingCopy : `固定${vocabulary.revision}`} · {backlink.count}箇所</span>
				</button>
			{:else}
				<p class="empty">{vocabulary.backlink}はありません</p>
			{/each}
		</section>
		{#if internalReferenceNotice}<p class="internal-reference-notice" role="status">{internalReferenceNotice}</p>{/if}
		<div class="discoveries">
			{#if emergenceLoading}<p class="empty">{vocabulary.emergenceLoading}</p>{/if}
			{#each emergenceSuggestions as suggestion (suggestion.id)}
				<article class:pinned={suggestion.status === "pinned"}>
					<div class="discovery-title"><span>{suggestion.title}</span><small>{Math.round(suggestion.score * PERCENT_SCALE)}%</small></div>
					<strong>{titleForId(suggestion.targetItemId)}</strong>
					<p>{suggestion.explanation}</p>
					<ol>{#each suggestion.evidence as step}<li>{step.relation}: {titleForId(step.fromId)} → {titleForId(step.toId)}</li>{/each}</ol>
					<input
						class="reason-input"
						aria-label={vocabulary.emergenceResolutionReason}
						placeholder={vocabulary.emergenceResolutionReason}
						value={emergenceResolutionReasons[suggestion.id] ?? ""}
						oninput={(event) => onSetEmergenceReason(suggestion.id, event.currentTarget.value)}
					/>
					<div class="suggestion-actions">
						<button type="button" onclick={() => void onResolveEmergence(suggestion, "accept")}>{vocabulary.emergenceAccept}</button>
						<button type="button" onclick={() => void onResolveEmergence(suggestion, "pin")}>{vocabulary.emergenceHold}</button>
						<button type="button" onclick={() => void onResolveEmergence(suggestion, "dismiss")} disabled={!emergenceResolutionReasons[suggestion.id]?.trim()}>{vocabulary.emergenceDismiss}</button>
					</div>
				</article>
			{:else}
				{#if !emergenceLoading}<p class="empty">{vocabulary.noEmergenceSuggestion}</p>{/if}
			{/each}
		</div>
	</div>
{/if}

<style>
	.inline-semantic-link-notice,
	.internal-reference-notice {
		margin: 8px 0;
		padding: 6px 9px;
		border-radius: 5px;
		border-left: 2px solid var(--cyan);
		background: var(--surface-hover);
		color: var(--cyan-soft);
		font-size: 10px;
	}
	.internal-reference-backlinks {
		margin-top: 18px;
		border-top: 1px solid var(--border);
		padding-top: 14px;
	}
	.internal-reference-backlinks h3 {
		display: flex;
		justify-content: space-between;
		margin: 0 0 8px;
		color: var(--muted);
		font-size: 10px;
		font-weight: normal;
		letter-spacing: .08em;
	}
	.internal-reference-backlinks h3 small {
		font-size: inherit;
		letter-spacing: normal;
	}
	.backlink-entry {
		display: grid;
		gap: 2px;
		width: 100%;
		margin-bottom: 5px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-raised);
		color: var(--text);
		padding: 6px 8px;
		text-align: left;
		cursor: pointer;
	}
	.backlink-entry:hover {
		border-color: var(--border-bright);
		background: var(--surface-hover);
	}
	.backlink-entry strong {
		font-weight: 500;
		font-size: 11px;
	}
	.backlink-entry span {
		font-size: 10px;
		color: var(--theme-muted, #8fa0a8);
	}
	.discoveries {
		display: grid;
		gap: 10px;
		margin-top: 18px;
		border-top: 1px solid var(--border);
		padding-top: 14px;
	}
	.discoveries article {
		padding: 11px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface-raised);
	}
	.discoveries article.pinned {
		border-color: var(--amber);
	}
	.discovery-title {
		display: flex;
		justify-content: space-between;
		margin-bottom: 7px;
		color: var(--cyan);
		font-size: 9px;
		letter-spacing: .08em;
	}
	.discoveries article > strong {
		font-family: var(--font-serif);
		font-size: 13px;
	}
	.discoveries article p,
	.discoveries article ol {
		color: var(--theme-muted, #9aadb6);
		font-size: 10px;
		line-height: 1.5;
	}
	.discoveries article ol {
		padding-left: 17px;
	}
	.discoveries article input.reason-input {
		width: 100%;
		margin: 6px 0;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 6px 8px;
		background: var(--theme-surface-raised, #04080d);
		color: var(--text);
		font-size: 10px;
	}
	.suggestion-actions {
		display: flex;
		gap: 6px;
	}
	.suggestion-actions button {
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 5px 8px;
		background: var(--surface-hover);
		cursor: pointer;
		font-size: 10px;
	}
	.empty {
		color: var(--muted);
		font-size: 12px;
		text-align: center;
	}
</style>
