<script lang="ts">
	import type { OutlineItem, RecoverySnapshot } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type { CommandAvailability, CommandId } from "./command_service.ts";

	export type HistoryCommands = Pick<
		Readonly<Record<CommandId, CommandAvailability>>,
		"createBranch"
	>;

	export type InspectorHistoryTabProps = {
		selectedItem: OutlineItem | null;
		selectedBranchId: string | null;
		recoverySnapshots: readonly RecoverySnapshot[];
		vocabulary: UiVocabulary;
		commands: HistoryCommands;
		onCreateBranch: () => void | Promise<void>;
		onOpenWorkLineage: () => void;
		onOpenRevisionComparison: () => void;
	};

	let {
		selectedItem,
		selectedBranchId,
		recoverySnapshots,
		vocabulary,
		commands,
		onCreateBranch,
		onOpenWorkLineage,
		onOpenRevisionComparison,
	}: InspectorHistoryTabProps = $props();
</script>

<div class="history-panel">
	<p class="history-hint">選択中の{vocabulary.work}に従属する履歴です。</p>
	<button
		type="button"
		class="history-btn"
		onclick={() => void onCreateBranch()}
		disabled={!commands.createBranch.enabled}
		title={commands.createBranch.reason}
	>新しい{vocabulary.branch}を作る</button>
	<button type="button" class="history-btn" onclick={onOpenWorkLineage} disabled={!selectedItem}>{vocabulary.workLineage}を開く</button>
	<button type="button" class="history-btn" onclick={onOpenRevisionComparison} disabled={!selectedItem}>{vocabulary.revision}{vocabulary.comparisonPane}を開く</button>
	{#if selectedBranchId}
		<button type="button" class="history-btn" onclick={onOpenWorkLineage}>Recovery snapshotsを開く</button>
		<small>{recoverySnapshots.length}件のRecovery snapshot</small>
	{:else}
		<small>Recoveryは{vocabulary.branch}を選択すると利用できます。</small>
	{/if}
</div>

<style>
	.history-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.history-panel button.history-btn {
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 7px 9px;
		background: transparent;
		color: #aebdc5;
		text-align: left;
		cursor: pointer;
		font-size: 11px;
	}
	.history-panel button.history-btn:hover:not(:disabled) {
		border-color: var(--border);
		background: var(--surface-hover);
		color: var(--text);
	}
	.history-panel button.history-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.history-panel p.history-hint {
		margin: 0 0 8px;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.6;
	}
	.history-panel small {
		margin-top: 4px;
		color: var(--muted);
		font-size: 10px;
	}
</style>
