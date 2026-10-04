<script lang="ts">
	import type { Snippet } from "svelte";
	let { loading, error, onRetry, children }: {
		loading: boolean;
		error: string;
		onRetry: () => void;
		children: Snippet;
	} = $props();
</script>

<section class="tree-view">
	{#if loading}
		<p class="tree-status" role="status">ツリーを読み込んでいます…</p>
	{:else if error}
		<div class="tree-status" role="alert">
			<p>ツリーを読み込めませんでした: {error}</p>
			<button type="button" onclick={onRetry}>ツリーを再試行</button>
		</div>
	{/if}
	<div class="tree-result">{@render children()}</div>
</section>

<style>
	.tree-view {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.tree-result {
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}
	.tree-status {
		padding: 0.75rem 1rem;
		margin: 0;
	}
	.tree-status p {
		margin: 0 0 0.5rem;
	}
</style>
