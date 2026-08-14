<script lang="ts">
	import type { WorkingCopySaveStatus as WorkingCopySaveStatusValue } from "../services/working_copy_autosave.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		status,
		onRetry,
	}: {
		status: WorkingCopySaveStatusValue;
		onRetry: () => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
</script>

<div
	class="working-copy-save-status"
	class:failed={status.phase === "failed"}
	class:pending={status.phase === "unsaved" || status.phase === "saving"}
	aria-live="polite"
	title={status.error}
>
	<span>
		{status.phase === "failed"
			? `${vocabulary.workingCopy}を保存できませんでした`
			: status.phase === "saving"
				? `${vocabulary.workingCopy}を保存中…`
				: status.phase === "unsaved"
					? `未保存の${vocabulary.workingCopy}があります`
					: `${vocabulary.workingCopy}を保存しました`}
	</span>
	{#if status.phase === "failed"}
		<button type="button" onclick={onRetry}>再試行</button>
	{/if}
</div>

<style>
	.working-copy-save-status {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 150px;
		color: var(--muted);
		font-size: 10px;
	}
	.working-copy-save-status span {
		margin: 0;
		letter-spacing: normal;
		text-transform: none;
	}
	.working-copy-save-status.pending {
		color: var(--amber);
	}
	.working-copy-save-status.failed {
		color: #ffb8af;
	}
	.working-copy-save-status button {
		border: 1px solid currentcolor;
		border-radius: 5px;
		padding: 3px 6px;
		background: transparent;
		cursor: pointer;
	}
</style>
