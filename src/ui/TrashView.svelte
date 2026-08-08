<script lang="ts">
	import type { TrashEntry } from "../domain/models.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		entries,
		onRestore,
		onPurge,
	}: {
		entries: TrashEntry[];
		onRestore: (workId: string) => void | Promise<void>;
		onPurge: (entry: TrashEntry) => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
</script>

<section class="outline-panel">
	<div class="section-title"><span>ゴミ箱</span><small>{entries.length}件</small></div>
	<div class="stash-list">
		{#each entries as entry}
			<div>
				<span>{entry.work.id.slice(0, 8)} · {vocabulary.occurrence}{entry.occurrenceCount}件 · {vocabulary.semanticLink}{entry.linkCount}件</span>
				<button onclick={() => onRestore(entry.work.id)}>復元</button>
				<button class="delete" onclick={() => onPurge(entry)}>完全消去</button>
			</div>
		{:else}
			<p class="empty">ゴミ箱は空です</p>
		{/each}
	</div>
</section>
