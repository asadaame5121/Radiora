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
