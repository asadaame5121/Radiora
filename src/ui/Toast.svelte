<script lang="ts">
	import { onMount } from "svelte";

	let {
		title,
		message,
		onDismiss,
		durationMs = 6000,
	}: {
		title: string;
		message: string;
		onDismiss: () => void;
		durationMs?: number;
	} = $props();

	onMount(() => {
		const timer = globalThis.setTimeout(onDismiss, durationMs);
		return () => globalThis.clearTimeout(timer);
	});
</script>

<div class="toast" role="status" aria-live="polite">
	<div>
		<strong>{title}</strong>
		<p>{message}</p>
	</div>
	<button type="button" aria-label="閉じる" onclick={onDismiss}>×</button>
</div>

<style>
	.toast {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 100;
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		width: min(24rem, calc(100vw - 2.5rem));
		padding: 0.9rem 1rem;
		border: 1px solid var(--border-bright);
		border-radius: 0.75rem;
		background: var(--surface-raised);
		box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 35%);
		color: var(--text);
	}

	.toast div {
		min-width: 0;
		flex: 1;
	}

	.toast strong {
		display: block;
		margin-bottom: 0.25rem;
	}

	.toast p {
		margin: 0;
		color: var(--muted);
		line-height: 1.45;
	}

	.toast button {
		min-width: 2rem;
		padding: 0.15rem 0.4rem;
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 1.2rem;
	}
</style>
