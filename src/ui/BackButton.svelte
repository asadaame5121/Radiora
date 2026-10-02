<script lang="ts">
	let { enabled, onBack }: { enabled: boolean; onBack: () => void } = $props();
</script>

<button type="button" aria-label="前の画面へ戻る" title="前の画面へ戻る (Alt+←)"
	disabled={!enabled} onclick={onBack}>← 戻る</button>

<style>
	button {
		flex: 0 0 auto;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 8px;
		background: transparent;
		color: var(--text-secondary);
		white-space: nowrap;
		cursor: pointer;
	}
	button:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
	button:disabled { opacity: .4; cursor: not-allowed; }
</style>
