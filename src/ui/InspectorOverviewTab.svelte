<script lang="ts">
	import type { OutlineItem } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type { CommandAvailability, CommandId } from "./command_service.ts";

	export type OverviewCommands = Pick<
		Readonly<Record<CommandId, CommandAvailability>>,
		"startLongFormEditing"
	>;

	export type InspectorOverviewTabProps = {
		selectedItem: OutlineItem | null;
		selectedPlacements: readonly OutlineItem[];
		vocabulary: UiVocabulary;
		commands: OverviewCommands;
		showOutlineHint: boolean;
		onUpdateSelectedHeading: (value: string) => void | Promise<void>;
		onSelectPlacement: (id: string) => void;
		onStartLongFormEditing: () => void;
		titleFor: (item: OutlineItem) => string;
		titleForId: (id: string) => string;
		formatCreatedAt: (value: string) => string;
	};

	let {
		selectedItem,
		selectedPlacements,
		vocabulary,
		commands,
		showOutlineHint,
		onUpdateSelectedHeading,
		onSelectPlacement,
		onStartLongFormEditing,
		titleFor,
		titleForId,
		formatCreatedAt,
	}: InspectorOverviewTabProps = $props();
</script>

{#if selectedItem}
	<div>
		<label class="heading-label">
			{vocabulary.occurrence}固有の見出し
			<input
				value={selectedItem.contextualHeading ?? ""}
				onchange={(event) => void onUpdateSelectedHeading(event.currentTarget.value)}
				placeholder="未設定時は本文の先頭行"
			/>
		</label>
		<section class="placements">
			<h3>{vocabulary.occurrence}一覧<small>{selectedPlacements.length}件</small></h3>
			<div class="placements-list">
				{#each selectedPlacements as placement (placement.id)}
					<button
						type="button"
						class:active={placement.id === selectedItem.id}
						onclick={() => onSelectPlacement(placement.id)}
					>
						<strong>{titleFor(placement)}</strong>
						<span>{placement.parentId ? `親: ${titleForId(placement.parentId)}` : "ルート"}</span>
					</button>
				{/each}
			</div>
		</section>
		<div class="discovery-actions">
			<button
				type="button"
				class="overview-action-btn"
				onclick={onStartLongFormEditing}
				disabled={!commands.startLongFormEditing.enabled}
				title={commands.startLongFormEditing.reason}
			>{vocabulary.manuscriptOpen}</button>
		</div>
		<div class="thought-meta">
			<div>
				<span class="meta-label">作成日</span>
				<time datetime={selectedItem.createdAt}>{formatCreatedAt(selectedItem.createdAt)}</time>
			</div>
			<div>
				<span class="meta-label">更新日</span>
				<time datetime={selectedItem.updatedAt}>{formatCreatedAt(selectedItem.updatedAt)}</time>
			</div>
			{#if selectedItem.parentId}
				<div>
					<span class="meta-label">親</span>
					<span>{titleForId(selectedItem.parentId)}</span>
				</div>
			{/if}
		</div>
		{#if showOutlineHint}
			<p class="hint">Enter: 兄弟　Shift+Enter: 改行<br />Tab / Shift+Tab: 階層　Alt+↑↓: 移動</p>
		{/if}
	</div>
{/if}

<style>
	.heading-label {
		display: grid;
		gap: 6px;
		color: var(--muted);
		font-size: 11px;
	}
	.heading-label input {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 7px 8px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 11px;
	}
	.placements {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.placements h3 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 8px;
		color: var(--muted);
		font-size: 10px;
		letter-spacing: .08em;
	}
	.placements h3 small {
		font-size: 9px;
		color: var(--muted);
	}
	.placements-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.placements-list button {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-raised);
		color: var(--text);
		padding: 7px 8px;
		text-align: left;
		cursor: pointer;
	}
	.placements-list button.active {
		border-color: var(--cyan);
	}
	.placements-list button strong {
		font-size: 11px;
		font-weight: normal;
	}
	.placements-list button span {
		color: var(--muted);
		font-size: 10px;
	}
	.discovery-actions {
		display: flex;
		gap: 6px;
		margin-top: 14px;
	}
	.overview-action-btn {
		display: block;
		width: 100%;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-hover);
		color: var(--cyan-soft);
		font-size: 11px;
		text-align: center;
		cursor: pointer;
	}
	.overview-action-btn:hover:not(:disabled) {
		border-color: var(--cyan);
		color: var(--text);
	}
	.thought-meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 18px 0 0;
		padding: 11px 0;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		color: var(--muted);
		font-size: 11px;
	}
	.thought-meta > div {
		display: flex;
		justify-content: space-between;
	}
	.thought-meta .meta-label {
		color: var(--muted);
	}
	.thought-meta time {
		color: #b9cbd2;
	}
	.hint {
		color: var(--muted);
		font-size: 11px;
		line-height: 1.8;
		border-bottom: 1px solid var(--border);
		padding-bottom: 18px;
	}
</style>
