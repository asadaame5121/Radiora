<script lang="ts">
	import { onDestroy } from "svelte";
	import type {
		CreateLinkInput,
		OutlineItem,
		OutlineLink,
		SearchRequest,
		SearchResult,
	} from "../domain/models.ts";
	import { isSymmetricLinkType, LINK_TYPES } from "../domain/models.ts";
	import { isComparableLinkType } from "../services/comparison_service.ts";
	import {
		LinkEditorController,
		type LinkEditorControllerPorts,
	} from "./link_editor_controller.svelte.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	type LinkEditorProps = LinkEditorControllerPorts & {
		selectedWorkId: string;
		selectedDisplayName?: string;
		links: readonly OutlineLink[];
		titleForWork: (workId: string) => string;
	};

	let props: LinkEditorProps = $props();

	const vocabulary = useUiVocabulary();
	const controller = new LinkEditorController({
		onConfirm: (input) => props.onConfirm(input),
		onDelete: (link) => props.onDelete(link),
		onReverse: (link) => props.onReverse(link),
		onCompare: (link) => props.onCompare?.(link),
		onSearch: (req) => props.onSearch(req),
	});

	let initializedWorkId = "";
	$effect(() => {
		const workId = props.selectedWorkId;
		if (workId === initializedWorkId) return;
		initializedWorkId = workId;
		controller.reset();
	});

	const currentLinks = $derived(
		props.links.filter(
			(link) => link.fromId === props.selectedWorkId || link.toId === props.selectedWorkId,
		),
	);

	function titleOf(item: OutlineItem): string {
		return item.contextualHeading ??
			item.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
			`(空の${vocabulary.work})`;
	}

	function snippetOf(item: OutlineItem): string {
		return item.text.replace(/\s+/g, " ").trim().slice(0, 96);
	}

	function otherWorkId(link: OutlineLink): string {
		return link.fromId === props.selectedWorkId ? link.toId : link.fromId;
	}

	function linkDirection(link: OutlineLink): string {
		if (isSymmetricLinkType(link.type)) return "↔";
		return link.fromId === props.selectedWorkId ? "→" : "←";
	}

	onDestroy(() => controller.destroy());
</script>

<section class="link-editor" aria-label={`${vocabulary.semanticLink}編集`}>
	<h3>{vocabulary.semanticLink}</h3>
	{#if props.selectedDisplayName}<p class="link-editor-context">選択中: {props.selectedDisplayName}</p>{/if}

	<section class="link-editor-section" aria-labelledby="current-links-heading">
		<h4 id="current-links-heading">接続中の{vocabulary.semanticLink}<small>{currentLinks.length}件</small></h4>
		{#if currentLinks.length === 0}
			<p class="link-editor-empty">接続されている{vocabulary.semanticLink}はありません</p>
		{:else}
			<ul class="link-editor-list">
				{#each currentLinks as link (link.id)}
					<li>
						<div class="link-editor-link-copy">
							<strong>{props.titleForWork(otherWorkId(link))}</strong>
							<span>{link.type} {linkDirection(link)}{#if link.origin === "derived"}（暗黙）{/if}</span>
							{#if link.reason}<small>「{link.reason}」</small>{/if}
						</div>
						<div class="link-editor-link-actions">
							{#if props.onCompare && isComparableLinkType(link.type)}
								<button
									type="button"
									disabled={Boolean(controller.activeLinkId) || controller.submitting}
									onclick={() => void controller.compareLink(link)}
								>{vocabulary.comparisonPane}</button>
							{/if}
							<button
								type="button"
								disabled={Boolean(controller.activeLinkId) || controller.submitting || isSymmetricLinkType(link.type) || link.origin === "derived"}
								title={link.origin === "derived" ? "アウトライン階層から導出された関係のため直接変更できません" : isSymmetricLinkType(link.type) ? "対称な関係には向きがありません" : "向きを反転"}
								onclick={() => void controller.reverseLink(link)}
							>反転</button>
							<button
								type="button"
								class="danger"
								disabled={Boolean(controller.activeLinkId) || controller.submitting || link.origin === "derived"}
								title={link.origin === "derived" ? "アウトライン階層から導出された関係のため直接変更できません" : "接続を解除"}
								onclick={() => void controller.deleteLink(link)}
							>解除</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="link-editor-section" aria-labelledby="new-link-heading">
		<h4 id="new-link-heading">新しい{vocabulary.semanticLink}</h4>
		<div class="link-editor-form-row">
			<label>
				<span>{vocabulary.linkType}</span>
				<select bind:value={controller.selectedType} disabled={controller.submitting} aria-label={`${vocabulary.semanticLink}種別`}>
					{#each LINK_TYPES as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>向き</span>
				<select bind:value={controller.direction} disabled={controller.submitting} aria-label={`${vocabulary.semanticLink}の向き`}>
					<option value="outgoing">選択中 → 検索結果</option>
					<option value="incoming">検索結果 → 選択中</option>
				</select>
			</label>
		</div>
		{#if isSymmetricLinkType(controller.selectedType)}
			<p class="link-editor-hint">{controller.selectedType}は対称な関係のため、保存時に向きは正規化されます。</p>
		{/if}
		<label>
			<span>説明（任意）</span>
			<input bind:value={controller.reason} disabled={controller.submitting} placeholder="この関係の理由" />
		</label>
		<div class="link-editor-search">
			<input
				type="search"
				bind:value={controller.searchQuery}
				oninput={() => controller.scheduleSearch(props.selectedWorkId)}
				placeholder="ノードを検索して接続…"
				aria-label="接続先を検索"
				aria-busy={controller.searching}
				disabled={controller.submitting}
				autocomplete="off"
			/>
			{#if controller.searching}<span class="link-editor-searching" aria-label="検索中">…</span>{/if}
		</div>
		{#if controller.searchError}<p class="link-editor-error" role="alert">{controller.searchError}</p>{/if}
		{#if controller.searchQuery.trim() && !controller.searching && !controller.searchError && controller.searchResults.length === 0}
			<p class="link-editor-empty">一致する{vocabulary.work}はありません</p>
		{/if}
		{#if controller.searchResults.length > 0}
			<ul class="link-editor-results" aria-label="接続先候補">
				{#each controller.searchResults as result (result.item.workId)}
					<li>
						<button type="button" disabled={controller.submitting} onclick={() => void controller.addLink(result, props.selectedWorkId)}>
							<strong>{titleOf(result.item)}</strong>
							{#if snippetOf(result.item)}<small>{snippetOf(result.item)}</small>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</section>

<style>
	.link-editor {
		display: grid;
		gap: 8px;
		margin-top: 18px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.link-editor h3,
	.link-editor p,
	.link-editor h4 {
		margin: 0;
	}
	.link-editor-section {
		display: grid;
		gap: 7px;
	}
	.link-editor-section + .link-editor-section {
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.link-editor-section h4 {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		color: var(--muted);
		font-size: 10px;
		font-weight: normal;
		letter-spacing: .08em;
	}
	.link-editor-section h4 small {
		font-size: inherit;
		letter-spacing: normal;
	}
	.link-editor-list,
	.link-editor-results {
		display: grid;
		gap: 5px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.link-editor-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-width: 0;
		padding: 7px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-raised);
	}
	.link-editor-link-copy {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.link-editor-link-copy strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		font-weight: normal;
	}
	.link-editor-link-copy span,
	.link-editor-link-copy small {
		color: var(--muted);
		font-size: 10px;
	}
	.link-editor-link-copy small {
		font-style: italic;
	}
	.link-editor-link-actions {
		display: flex;
		flex: none;
		gap: 3px;
	}
	.link-editor-link-actions button {
		padding: 3px 6px;
		border-color: transparent;
		background: transparent;
		color: var(--muted);
		font-size: 10px;
	}
	.link-editor-link-actions button:hover:not(:disabled) {
		border-color: var(--border-bright);
		background: var(--surface-hover);
		color: var(--text);
	}
	.link-editor-link-actions button.danger:hover:not(:disabled) {
		border-color: var(--theme-error-border, #71433d);
		color: var(--theme-error-text, #ffb8af);
	}
	.link-editor-form-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 6px;
	}
	.link-editor label {
		display: grid;
		gap: 4px;
		color: var(--muted);
		font-size: 10px;
	}
	.link-editor label input,
	.link-editor label select,
	.link-editor-search input {
		width: 100%;
		min-width: 0;
		padding: 7px 8px;
		font-size: 11px;
	}
	.link-editor-hint,
	.link-editor-empty,
	.link-editor-error {
		color: var(--muted);
		font-size: 10px;
	}
	.link-editor-hint {
		padding: 5px 7px;
		border-left: 2px solid var(--cyan);
		background: var(--surface-hover);
	}
	.link-editor-search {
		position: relative;
	}
	.link-editor-searching {
		position: absolute;
		top: 6px;
		right: 9px;
		color: var(--cyan);
		font-size: 12px;
	}
	.link-editor-error {
		padding: 6px 8px;
		border-left: 2px solid var(--red);
		background: var(--surface-hover);
		color: var(--theme-error-text, #ffb8af);
	}
	.link-editor-results {
		max-height: 190px;
		overflow: auto;
	}
	.link-editor-results button {
		display: grid;
		gap: 3px;
		width: 100%;
		padding: 7px 8px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-raised);
		color: var(--text);
		text-align: left;
		font-size: 11px;
	}
	.link-editor-results button:hover:not(:disabled) {
		border-color: var(--cyan);
		background: var(--surface-hover);
	}
	.link-editor-results button small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-size: 10px;
	}
</style>
