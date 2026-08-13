<script lang="ts">
	import { onDestroy } from "svelte";
	import type { CreateLinkInput, LinkType, OutlineItem, OutlineLink, RelationTypeDefinition, SearchResult } from "../domain/models";
import type { RadioraBindings } from "../shared/bindings";
import { isComparableLinkType } from "../services/comparison_service";
	import { useUiVocabulary } from "./ui_vocabulary_context";
	import { createRpcAdapter } from "./rpc_adapter";

	type LinkDirection = "outgoing" | "incoming";

	let {
		selectedWorkId,
		selectedDisplayName,
		links,
		titleForWork,
		onConfirm,
		onDelete,
		onReverse,
		onCompare,
		relationTypeDefinitions,
	}: {
		selectedWorkId: string;
		selectedDisplayName?: string;
		links: readonly OutlineLink[];
		titleForWork: (workId: string) => string;
		onConfirm: (input: CreateLinkInput) => void | Promise<void>;
		onDelete: (link: OutlineLink) => void | Promise<void>;
		onReverse: (link: OutlineLink) => void | Promise<void>;
		onCompare?: (link: OutlineLink) => void | Promise<void>;
		relationTypeDefinitions: readonly RelationTypeDefinition[];
	} = $props();

	const vocabulary = useUiVocabulary();
	const api = createRpcAdapter<RadioraBindings>();

	let searchQuery = $state("");
	let searchResults = $state<SearchResult[]>([]);
	let searching = $state(false);
	let searchError = $state("");
	let searchTimer: number | undefined;
	let searchRequestId = 0;
	let selectedType = $state<LinkType>("LIKE");
	let direction = $state<LinkDirection>("outgoing");
	let reason = $state("");
	let submitting = $state(false);
	let activeLinkId = $state<string | null>(null);
	let initializedWorkId = "";

	const currentLinks = $derived(
		links.filter((link) => link.fromId === selectedWorkId || link.toId === selectedWorkId),
	);
	const definitionByName = $derived(new Map(relationTypeDefinitions.map((entry) => [entry.name, entry])));
	function isSymmetric(type: LinkType): boolean {
		return definitionByName.get(type)?.direction === "symmetric";
	}

	$effect(() => {
		const workId = selectedWorkId;
		if (workId === initializedWorkId) return;
		initializedWorkId = workId;
		clearSearch();
		direction = "outgoing";
		reason = "";
	});

	function scheduleSearch(): void {
		if (searchTimer !== undefined) window.clearTimeout(searchTimer);
		const requestId = ++searchRequestId;
		const query = searchQuery.trim();
		searchError = "";
		searchResults = [];
		if (!query) {
			searching = false;
			return;
		}
		searching = true;
		searchTimer = window.setTimeout(() => void search(query, requestId), 250);
	}

	async function search(query: string, requestId: number): Promise<void> {
		try {
			const results = await api.searchItems({
				query,
				contextItemId: selectedWorkId,
				limit: 16,
			});
			if (requestId !== searchRequestId) return;
			const seenWorkIds = new Set<string>();
			searchResults = results.filter((result) => {
				if (result.item.workId === selectedWorkId || seenWorkIds.has(result.item.workId)) return false;
				seenWorkIds.add(result.item.workId);
				return true;
			});
		} catch (cause) {
			if (requestId === searchRequestId) searchError = errorMessage(cause);
		} finally {
			if (requestId === searchRequestId) searching = false;
		}
	}

	function clearSearch(): void {
		searchRequestId++;
		if (searchTimer !== undefined) window.clearTimeout(searchTimer);
		searchTimer = undefined;
		searchQuery = "";
		searchResults = [];
		searchError = "";
		searching = false;
	}

	async function addLink(result: SearchResult): Promise<void> {
		if (submitting || result.item.workId === selectedWorkId) return;
		const fromId = direction === "outgoing" ? selectedWorkId : result.item.workId;
		const toId = direction === "outgoing" ? result.item.workId : selectedWorkId;
		try {
			submitting = true;
			searchError = "";
			await onConfirm({
				fromId,
				toId,
				type: selectedType,
				reason: reason.trim() || undefined,
			});
			clearSearch();
		} catch (cause) {
			searchError = errorMessage(cause);
		} finally {
			submitting = false;
		}
	}

	async function deleteLink(link: OutlineLink): Promise<void> {
		if (activeLinkId || submitting) return;
		try {
			activeLinkId = link.id;
			searchError = "";
			await onDelete(link);
		} catch (cause) {
			searchError = errorMessage(cause);
		} finally {
			activeLinkId = null;
		}
	}

	async function reverseLink(link: OutlineLink): Promise<void> {
		if (activeLinkId || submitting || isSymmetric(link.type)) return;
		try {
			activeLinkId = link.id;
			searchError = "";
			await onReverse(link);
		} catch (cause) {
			searchError = errorMessage(cause);
		} finally {
			activeLinkId = null;
		}
	}

	async function compareLink(link: OutlineLink): Promise<void> {
		if (activeLinkId || submitting || !onCompare) return;
		try {
			activeLinkId = link.id;
			searchError = "";
			await onCompare(link);
		} catch (cause) {
			searchError = errorMessage(cause);
		} finally {
			activeLinkId = null;
		}
	}

	function titleOf(item: OutlineItem): string {
		return item.contextualHeading ??
			item.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
			`(空の${vocabulary.work})`;
	}

	function snippetOf(item: OutlineItem): string {
		return item.text.replace(/\s+/g, " ").trim().slice(0, 96);
	}

	function otherWorkId(link: OutlineLink): string {
		return link.fromId === selectedWorkId ? link.toId : link.fromId;
	}

	function linkDirection(link: OutlineLink): string {
		if (isSymmetric(link.type)) return "↔";
		return link.fromId === selectedWorkId ? "→" : "←";
	}

	function errorMessage(cause: unknown): string {
		return cause instanceof Error ? cause.message : String(cause);
	}

	onDestroy(() => {
		if (searchTimer !== undefined) window.clearTimeout(searchTimer);
	});
</script>

<section class="link-editor" aria-label={`${vocabulary.semanticLink}編集`}>
	<h3>{vocabulary.semanticLink}</h3>
	{#if selectedDisplayName}<p class="link-editor-context">選択中: {selectedDisplayName}</p>{/if}

	<section class="link-editor-section" aria-labelledby="current-links-heading">
		<h4 id="current-links-heading">接続中の{vocabulary.semanticLink}<small>{currentLinks.length}件</small></h4>
		{#if currentLinks.length === 0}
			<p class="link-editor-empty">接続されている{vocabulary.semanticLink}はありません</p>
		{:else}
			<ul class="link-editor-list">
				{#each currentLinks as link (link.id)}
					<li>
						<div class="link-editor-link-copy">
							<strong>{titleForWork(otherWorkId(link))}</strong>
							<span>{link.type} {linkDirection(link)}</span>
							{#if link.reason}<small>「{link.reason}」</small>{/if}
						</div>
						<div class="link-editor-link-actions">
							{#if onCompare && isComparableLinkType(link.type)}
								<button
									type="button"
									disabled={Boolean(activeLinkId) || submitting}
									onclick={() => void compareLink(link)}
								>{vocabulary.comparisonPane}</button>
							{/if}
							<button
								type="button"
								disabled={Boolean(activeLinkId) || submitting || isSymmetric(link.type)}
								title={isSymmetric(link.type) ? "対称な関係には向きがありません" : "向きを反転"}
								onclick={() => void reverseLink(link)}
							>反転</button>
							<button
								type="button"
								class="danger"
								disabled={Boolean(activeLinkId) || submitting}
								title="接続を解除"
								onclick={() => void deleteLink(link)}
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
				<select bind:value={selectedType} disabled={submitting} aria-label={`${vocabulary.semanticLink}種別`}>
					{#each relationTypeDefinitions as definition (definition.name)}
						<option value={definition.name}>{definition.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>向き</span>
				<select bind:value={direction} disabled={submitting} aria-label={`${vocabulary.semanticLink}の向き`}>
					<option value="outgoing">選択中 → 検索結果</option>
					<option value="incoming">検索結果 → 選択中</option>
				</select>
			</label>
		</div>
		{#if isSymmetric(selectedType)}
			<p class="link-editor-hint">{selectedType}は対称な関係のため、保存時に向きは正規化されます。</p>
		{/if}
		<label>
			<span>説明（任意）</span>
			<input bind:value={reason} disabled={submitting} placeholder="この関係の理由" />
		</label>
		<div class="link-editor-search">
			<input
				type="search"
				bind:value={searchQuery}
				oninput={scheduleSearch}
				placeholder="ノードを検索して接続…"
				aria-label="接続先を検索"
				aria-busy={searching}
				disabled={submitting}
				autocomplete="off"
			/>
			{#if searching}<span class="link-editor-searching" aria-label="検索中">…</span>{/if}
		</div>
		{#if searchError}<p class="link-editor-error" role="alert">{searchError}</p>{/if}
		{#if searchQuery.trim() && !searching && !searchError && searchResults.length === 0}
			<p class="link-editor-empty">一致する{vocabulary.work}はありません</p>
		{/if}
		{#if searchResults.length > 0}
			<ul class="link-editor-results" aria-label="接続先候補">
				{#each searchResults as result (result.item.workId)}
					<li>
						<button type="button" disabled={submitting} onclick={() => void addLink(result)}>
							<strong>{titleOf(result.item)}</strong>
							{#if snippetOf(result.item)}<small>{snippetOf(result.item)}</small>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</section>
