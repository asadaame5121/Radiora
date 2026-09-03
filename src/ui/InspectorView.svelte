<script lang="ts">
	import { onMount } from "svelte";
	import { Tabs } from "bits-ui";
	import type { OutlineItem } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type {
		CommandAvailability,
		CommandId,
	} from "./command_service.ts";
	import InspectorHistoryTab, {
		type InspectorHistoryTabProps,
	} from "./InspectorHistoryTab.svelte";
	import InspectorOverviewTab, {
		type InspectorOverviewTabProps,
	} from "./InspectorOverviewTab.svelte";
	import InspectorQueryPanel, {
		type InspectorQueryState,
	} from "./InspectorQueryPanel.svelte";
	import InspectorRelationTab, {
		type InspectorRelationTabProps,
	} from "./InspectorRelationTab.svelte";

	export type InspectorAsideMode = "overview" | "relation" | "history" | "query";
	type InspectorTab = Exclude<InspectorAsideMode, "query">;
	export type { InspectorQueryState };
	type InspectorCommands = Pick<
		Readonly<Record<CommandId, CommandAvailability>>,
		"addBookmark" | "createBranch" | "createLink" | "runQuery" | "saveQuery" | "startLongFormEditing"
	>;

	export type InspectorViewProps = InspectorOverviewTabProps &
		InspectorRelationTabProps &
		InspectorHistoryTabProps & {
			asideMode: InspectorAsideMode;
			selectedItem: OutlineItem | null;
			commands: InspectorCommands;
			vocabulary: UiVocabulary;
			query: InspectorQueryState;
			onAsideModeChange: (mode: InspectorAsideMode) => void;
			onElement: (element: HTMLElement | null) => void;
			onStartResize: (event: PointerEvent) => void;
			onAddBookmark: () => void;
			onSelectOccurrence: (id: string | null) => void;
		};

	let props: InspectorViewProps = $props();

	let inspectorElement: HTMLElement | null = null;

	onMount(() => {
		props.onElement(inspectorElement);
		return () => props.onElement(null);
	});

	const tabValue = $derived<InspectorTab>(props.asideMode === "query" ? "overview" : props.asideMode);

	function isInspectorTab(value: string): value is InspectorTab {
		return value === "overview" || value === "relation" || value === "history";
	}

	function handleTabChange(value: string): void {
		if (isInspectorTab(value)) props.onAsideModeChange(value);
	}
</script>

<aside bind:this={inspectorElement} class="inspector">
	<button
		class="inspector-resize-handle"
		type="button"
		aria-label="右ペインの幅を変更"
		onpointerdown={props.onStartResize}
		title="ドラッグして幅を変更"
	></button>
	{#if props.selectedItem && props.asideMode === "query"}
		<InspectorQueryPanel
			query={props.query}
			vocabulary={props.vocabulary}
			commands={props.commands}
			titleForId={props.titleForId}
		/>
	{:else if props.selectedItem}
		<Tabs.Root
			value={tabValue}
			orientation="horizontal"
			activationMode="automatic"
			onValueChange={handleTabChange}
		>
			<Tabs.List aria-label="詳細表示">
				{#snippet child({ props })}
					<nav {...props} class="aside-tabs" aria-label="詳細表示">
						<Tabs.Trigger value="overview">
							{#snippet child({ props: triggerProps })}
								<button {...triggerProps} type="button" class={tabValue === "overview" ? "active" : ""}>概要</button>
							{/snippet}
						</Tabs.Trigger>
						<Tabs.Trigger value="relation">
							{#snippet child({ props: triggerProps })}
								<button {...triggerProps} type="button" class={tabValue === "relation" ? "active" : ""}>関係</button>
							{/snippet}
						</Tabs.Trigger>
						<Tabs.Trigger value="history">
							{#snippet child({ props: triggerProps })}
								<button {...triggerProps} type="button" class={tabValue === "history" ? "active" : ""}>履歴</button>
							{/snippet}
						</Tabs.Trigger>
					</nav>
				{/snippet}
			</Tabs.List>
			<p class="eyebrow">選択中</p>
			<div class="inspector-heading">
				<h2>{props.titleFor(props.selectedItem)}</h2>
				<div class="inspector-heading-actions">
					<button class="inspector-action" type="button" onclick={props.onAddBookmark} disabled={!props.commands.addBookmark.enabled} title={props.commands.addBookmark.reason}>☆ {props.vocabulary.bookmark}</button>
				</div>
			</div>
			<Tabs.Content value="overview">
				{#snippet child({ props: contentProps })}
					<div {...contentProps}>
						<InspectorOverviewTab
							selectedItem={props.selectedItem}
							selectedPlacements={props.selectedPlacements}
							vocabulary={props.vocabulary}
							commands={props.commands}
							showOutlineHint={props.showOutlineHint}
							onUpdateSelectedHeading={props.onUpdateSelectedHeading}
							onSelectPlacement={props.onSelectPlacement}
							onStartLongFormEditing={props.onStartLongFormEditing}
							titleFor={props.titleFor}
							titleForId={props.titleForId}
							formatCreatedAt={props.formatCreatedAt}
						/>
					</div>
				{/snippet}
			</Tabs.Content>
			<Tabs.Content value="relation">
				{#snippet child({ props: contentProps })}
					<div {...contentProps}>
						<InspectorRelationTab
							selectedItem={props.selectedItem}
							selectedLinks={props.selectedLinks}
							vocabulary={props.vocabulary}
							inlineSemanticLinkNotice={props.inlineSemanticLinkNotice}
							internalReferenceBacklinks={props.internalReferenceBacklinks}
							internalReferenceNotice={props.internalReferenceNotice}
							emergenceSuggestions={props.emergenceSuggestions}
							emergenceResolutionReasons={props.emergenceResolutionReasons}
							emergenceLoading={props.emergenceLoading}
							titleFor={props.titleFor}
							titleForId={props.titleForId}
							titleForWork={props.titleForWork}
							onConfirmLink={props.onConfirmLink}
							onDeleteLink={props.onDeleteLink}
							onReverseLink={props.onReverseLink}
							onCompareLink={props.onCompareLink}
							onSearch={props.onSearch}
							onOpenBacklink={props.onOpenBacklink}
							onSetEmergenceReason={props.onSetEmergenceReason}
							onResolveEmergence={props.onResolveEmergence}
						/>
					</div>
				{/snippet}
			</Tabs.Content>
			<Tabs.Content value="history">
				{#snippet child({ props: contentProps })}
					<div {...contentProps}>
						<InspectorHistoryTab
							selectedItem={props.selectedItem}
							selectedBranchId={props.selectedBranchId}
							recoverySnapshots={props.recoverySnapshots}
							vocabulary={props.vocabulary}
							commands={props.commands}
							onCreateBranch={props.onCreateBranch}
							onOpenWorkLineage={props.onOpenWorkLineage}
							onOpenRevisionComparison={props.onOpenRevisionComparison}
						/>
					</div>
				{/snippet}
			</Tabs.Content>
		</Tabs.Root>
	{:else}
		<div class="aside-empty">
			<span>•</span>
			<p>{props.vocabulary.work}を選択すると<br />{props.vocabulary.semanticLink}を編集できます</p>
		</div>
	{/if}
</aside>

<style>
	.inspector {
		position: relative;
		border-left: 1px solid var(--border);
		background: var(--theme-surface, rgb(8 16 26 / 92%));
		padding: 26px 22px;
		overflow: auto;
		min-width: 0;
	}
	.inspector-resize-handle {
		position: absolute;
		z-index: 2;
		top: 0;
		left: -7px;
		width: 14px;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: col-resize;
	}
	.inspector-resize-handle:hover,
	.inspector-resize-handle:focus-visible {
		background: rgb(37 198 209 / 18%);
		outline: 0;
	}
	.aside-tabs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 3px;
		margin: -10px 0 20px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 7px;
	}
	.aside-tabs button {
		border: 0;
		border-radius: 4px;
		padding: 6px 3px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		font-size: 10px;
	}
	.aside-tabs button.active {
		background: var(--surface-hover);
		color: var(--cyan-soft);
	}
	.eyebrow {
		color: var(--cyan);
		font-size: 9px;
		letter-spacing: .18em;
		margin: 0;
	}
	.inspector h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 18px;
		line-height: 1.5;
		font-weight: normal;
		color: var(--theme-text, #edf9fa);
		word-break: break-word;
	}
	.inspector-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		margin: 12px 0 16px;
	}
	.inspector-heading-actions {
		display: flex;
		flex: none;
		gap: 4px;
		flex-wrap: wrap;
	}
	.inspector-action {
		flex: none;
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 4px 6px;
		background: var(--surface-raised);
		color: var(--muted);
		font-size: 10px;
		cursor: pointer;
	}
	.inspector-action:hover:not(:disabled) {
		border-color: var(--border-bright);
		color: var(--text);
	}
	.aside-empty {
		color: var(--muted);
		font-size: 12px;
		text-align: center;
		margin-top: 40vh;
		transform: translateY(-50%);
		line-height: 1.7;
	}
	.aside-empty span {
		font-size: 36px;
		color: var(--border-bright);
	}
</style>
