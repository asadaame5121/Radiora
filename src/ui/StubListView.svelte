<script lang="ts">
	import type { StubListEntry } from "../services/stub_service.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		entries,
		onCreate,
		onUpdateText,
		onResolve,
	}: {
		entries: StubListEntry[];
		onCreate: () => void | Promise<void>;
		onUpdateText: (entry: StubListEntry, text: string) => void | Promise<void>;
		onResolve: (workId: string) => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();

	function createdViaLabel(entry: StubListEntry): string {
		return entry.createdVia === "stub-list"
			? vocabulary.stubList
			: vocabulary.advancedLinkEditor;
	}

	function formatInstant(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
	}
</script>

<section class="outline-panel stub-list" aria-label={vocabulary.stubList}>
	<div class="section-title">
		<span>{vocabulary.stubList}</span><small>{entries.length}件</small>
	</div>
	<p class="hint">
		{vocabulary.stub}は本文をこれから書くために明示作成された未配置の{vocabulary.work}です。
		本文を書き足してから明示的に解除してください。
	</p>
	<button type="button" onclick={onCreate}>新規{vocabulary.stub}を作成</button>
	<div class="unplaced-list">
		{#each entries as entry (entry.workId)}
			<article class="unplaced-entry stub-entry">
				<small>
					{formatInstant(entry.createdAt)} · {createdViaLabel(entry)}
					{#if entry.context} · {vocabulary.stubContext}: {entry.context}{/if}
				</small>
				<textarea
					rows="3"
					aria-label={`${vocabulary.stub}の${vocabulary.workingCopy}を編集`}
					placeholder={`${vocabulary.workingCopy}をここに書き足す`}
					value={entry.text}
					onchange={(event) => onUpdateText(entry, event.currentTarget.value)}
				></textarea>
				{#if entry.backlinks.length}
					<div class="stub-backlinks" aria-label={vocabulary.backlink}>
						{#each entry.backlinks as backlink, index (index)}
							<small>
								{vocabulary.backlink}: {backlink.displayName || `(空の${vocabulary.work})`}
								× {backlink.count}
							</small>
						{/each}
					</div>
				{/if}
				<div class="unplaced-actions">
					<button onclick={() => onResolve(entry.workId)} disabled={!entry.hasText}
					>{vocabulary.stub}を解除</button>
				</div>
			</article>
		{:else}
			<p class="empty">{vocabulary.stubList}は空です。</p>
		{/each}
	</div>
</section>
