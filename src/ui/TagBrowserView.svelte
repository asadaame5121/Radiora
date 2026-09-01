<script lang="ts">
	import type { ScopedTagSet, TagAlias } from "../domain/models.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	type TagCloudEntry = {
		name: string;
		workIds: readonly string[];
	};

	let {
		tagScopes,
		tagAliases,
		selectedTag = $bindable(null),
		tagRenameFrom = $bindable(""),
		tagRenameTo = $bindable(""),
		tagMergeSources = $bindable(""),
		tagMergeTarget = $bindable(""),
		tagError,
		workIds,
		titleForWorkId,
		onOpenTagNode,
		onRenameTag,
		onMergeTags,
	}: {
		tagScopes: ScopedTagSet[];
		tagAliases: TagAlias[];
		selectedTag: string | null;
		tagRenameFrom: string;
		tagRenameTo: string;
		tagMergeSources: string;
		tagMergeTarget: string;
		tagError: string;
		workIds: ReadonlySet<string>;
		titleForWorkId: (workId: string) => string;
		onOpenTagNode: (workId: string) => void | Promise<void>;
		onRenameTag: () => void | Promise<void>;
		onMergeTags: () => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
	const tagCloud = $derived.by(() => {
		const workIdsByTag = new Map<string, Set<string>>();
		for (const scope of tagScopes) {
			for (const tag of scope.tags) {
				const workIds = workIdsByTag.get(tag) ?? new Set<string>();
				workIds.add(scope.scope.workId);
				workIdsByTag.set(tag, workIds);
			}
		}
		return Array.from(workIdsByTag, ([name, workIds]) => ({
			name,
			workIds: Array.from(workIds).sort(),
		}) satisfies TagCloudEntry).sort((left, right) =>
			right.workIds.length - left.workIds.length || left.name.localeCompare(right.name)
		);
	});
	const selectedTagNodeIds = $derived(
		selectedTag ? tagCloud.find((tag) => tag.name === selectedTag)?.workIds ?? [] : [],
	);

	function tagCloudFontSize(count: number): string {
		return `${Math.min(22, 12 + Math.max(0, count - 1) * 2)}px`;
	}
</script>

<section class="outline-panel tag-browser" aria-label={vocabulary.tag}>
	<div class="tag-browser__heading">
		<div>
			<p class="eyebrow">知識の入口</p>
			<h1>{vocabulary.tag}</h1>
			<p>タグを選ぶと、付いている{vocabulary.work}を表示します。</p>
		</div>
	</div>
	{#if tagError}<p class="query-error">{tagError}</p>{/if}
	<section class="tag-browser__cloud" aria-label={`${vocabulary.tag}クラウド`}>
		{#each tagCloud as tag (tag.name)}
			<button
				class:active={selectedTag === tag.name}
				aria-pressed={selectedTag === tag.name}
				style={`font-size:${tagCloudFontSize(tag.workIds.length)}`}
				onclick={() => (selectedTag = tag.name)}
			>
				<span>#{tag.name}</span>
				<small>{tag.workIds.length}{vocabulary.work}</small>
			</button>
		{:else}
			<p class="empty">{vocabulary.tag}はまだありません。</p>
		{/each}
	</section>
	{#if selectedTag}
		<section class="tag-browser__results" aria-live="polite">
			<div class="section-title">
				<span>#{selectedTag}</span>
				<small>{selectedTagNodeIds.length}{vocabulary.work}</small>
			</div>
			<div>
				{#each selectedTagNodeIds as workId (workId)}
					<button onclick={() => onOpenTagNode(workId)}>
						<strong>{titleForWorkId(workId)}</strong>
						<span>{workIds.has(workId) ? "アウトラインで開く" : vocabulary.unplacedInbox}</span>
					</button>
				{/each}
			</div>
		</section>
	{:else}
		<p class="tag-browser__prompt">{vocabulary.tag}を選ぶと{vocabulary.work}一覧を表示します。</p>
	{/if}
	<details class="tag-browser__maintenance">
		<summary>{vocabulary.tag}を整理</summary>
		<datalist id="tag-candidates">
			{#each tagCloud as tag}<option value={`#${tag.name}`}>{tag.workIds.length}{vocabulary.work}</option>{/each}
		</datalist>
		<div class="tag-browser__maintenance-grid">
			<label>名前変更
				<input bind:value={tagRenameFrom} list="tag-candidates" placeholder="変更前" />
				<input bind:value={tagRenameTo} placeholder="変更後" />
				<button onclick={onRenameTag}>名前変更</button>
			</label>
			<label>統合
				<input bind:value={tagMergeSources} list="tag-candidates" placeholder="統合元をカンマ区切り" />
				<input bind:value={tagMergeTarget} placeholder="統合先" />
				<button onclick={onMergeTags}>統合</button>
			</label>
		</div>
		{#if tagAliases.length}
			<p class="tag-browser__aliases">{tagAliases.map((alias) => `#${alias.variants.join(", #")} → #${alias.canonicalName}`).join(" · ")}</p>
		{/if}
	</details>
</section>

<style>
	.tag-browser {
		max-width: 980px;
	}
	.tag-browser__heading {
		margin-bottom: 22px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}
	.tag-browser__heading h1 {
		margin: 3px 0 6px;
		font-family: var(--font-serif);
		font-size: clamp(24px, 3vw, 34px);
		font-weight: normal;
		color: var(--theme-text, #edf9fa);
	}
	.tag-browser__heading p:not(.eyebrow),
	.tag-browser__prompt,
	.tag-browser__aliases {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
	}
	.tag-browser__cloud {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px 10px;
		padding: 18px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: radial-gradient(circle at 50% 0, rgb(37 198 209 / 7%), transparent 62%),
		var(--surface);
	}
	.tag-browser__cloud button {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 5px 9px;
		background: transparent;
		color: var(--text-secondary);
		line-height: 1.2;
		cursor: pointer;
	}
	.tag-browser__cloud button:hover,
	.tag-browser__cloud button.active {
		border-color: var(--cyan);
		background: rgb(37 198 209 / 10%);
		color: var(--theme-text, #e5fcff);
	}
	.tag-browser__cloud small {
		color: var(--muted);
		font-size: 9px;
	}
	.tag-browser__results {
		margin-top: 22px;
	}
	.tag-browser__results > div:last-child {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 7px;
	}
	.tag-browser__results button {
		display: grid;
		gap: 4px;
		min-width: 0;
		padding: 11px 12px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface);
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.tag-browser__results button:hover {
		border-color: var(--border-bright);
		background: var(--surface-hover);
	}
	.tag-browser__results strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag-browser__results span {
		color: var(--muted);
		font-size: 10px;
	}
	.tag-browser__prompt {
		margin-top: 18px;
	}
	.tag-browser__maintenance {
		margin-top: 34px;
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}
	.tag-browser__maintenance summary {
		color: var(--muted);
		font-size: 12px;
		cursor: pointer;
	}
	.tag-browser__maintenance-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin-top: 14px;
	}
	.tag-browser__maintenance label {
		display: grid;
		gap: 6px;
		color: var(--muted);
		font-size: 10px;
	}
	.tag-browser__maintenance input,
	.tag-browser__maintenance button {
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 7px 8px;
		background: var(--surface);
		color: var(--text);
	}
	.tag-browser__maintenance button {
		justify-self: start;
		cursor: pointer;
	}
	.tag-browser__aliases {
		margin-top: 12px;
	}
	@media (max-width: 700px) {
		.tag-browser__maintenance-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
