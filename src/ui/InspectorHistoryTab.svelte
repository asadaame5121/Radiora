<script lang="ts">
	import type { OutlineItem, RecoverySnapshot, Revision } from "../domain/models.ts";
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
		revisions: readonly Revision[];
		vocabulary: UiVocabulary;
		commands: HistoryCommands;
		onCreateBranch: () => void | Promise<void>;
		onOpenWorkLineage: () => void;
		onOpenRevisionComparison: () => void;
		onSelectRevision: (revisionId: string | null) => void | Promise<void>;
	};

	let {
		selectedItem,
		selectedBranchId,
		recoverySnapshots,
		revisions,
		vocabulary,
		commands,
		onCreateBranch,
		onOpenWorkLineage,
		onOpenRevisionComparison,
		onSelectRevision,
	}: InspectorHistoryTabProps = $props();

	const selectedRevisionId = $derived(
		selectedItem?.revisionSelector.mode === "pinned"
			? selectedItem.revisionSelector.revisionId
			: "",
	);
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
	<label class="revision-selector">
		<span>この配置で表示する{vocabulary.revision}</span>
		<select
			value={selectedRevisionId}
			disabled={!selectedItem}
			onchange={(event) => void onSelectRevision(event.currentTarget.value || null)}
		>
			<option value="">現在の本稿</option>
			{#each revisions as revision (revision.id)}
				<option value={revision.id}>{revision.message ?? `${vocabulary.fixedRevision} ${revision.id.slice(0, 8)}`}</option>
			{/each}
		</select>
	</label>
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
		color: var(--text-secondary);
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
	.revision-selector {
		display: grid;
		gap: 5px;
		margin-top: 6px;
		color: var(--muted);
		font-size: 10px;
	}
	.revision-selector select {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 7px;
		background: var(--theme-surface-raised, #04080d);
		color: var(--text);
	}
</style>
