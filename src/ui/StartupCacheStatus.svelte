<script lang="ts">
	import type { StartupStatus } from "../shared/bindings.ts";

	let {
		startup,
		onRetry,
		onReload,
	}: {
		startup: StartupStatus;
		onRetry: () => void | Promise<void>;
		onReload: () => void | Promise<void>;
	} = $props();
</script>

<section class="startup-cache-status" role="status" aria-live="polite">
	{#if startup.phase === "failed"}
		<span>前回の内容を表示しています。起動に失敗しました。</span>
		<button type="button" onclick={onRetry}>再試行</button>
	{:else if startup.phase === "ready"}
		<span>前回の内容を表示しています。最新データを読み込めませんでした。</span>
		<button type="button" onclick={onReload}>再読み込み</button>
	{:else}
		<span>前回の内容を表示しています。最新データを同期中…</span>
	{/if}
</section>

<style>
	.startup-cache-status {
		position: fixed;
		z-index: 100;
		right: 24px;
		bottom: 24px;
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: min(520px, calc(100vw - 48px));
		padding: 10px 14px;
		border: 1px solid #4d7a85;
		border-radius: 8px;
		background: rgb(10 28 38 / 96%);
		box-shadow: 0 12px 32px #0008;
		color: #d5edf0;
		font-size: 12px;
	}
	.startup-cache-status button {
		border: 1px solid var(--border-bright);
		border-radius: 5px;
		padding: 5px 8px;
		background: var(--surface-hover);
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
</style>
