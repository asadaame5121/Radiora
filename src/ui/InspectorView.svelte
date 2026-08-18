<script lang="ts">
	import { onMount } from "svelte";
	import { Tabs } from "bits-ui";
	import type {
		CreateLinkInput,
		EmergenceSuggestion,
		OutlineItem,
		OutlineLink,
		RecoverySnapshot,
		RuleQueryResult,
		SavedRuleQuery,
		SearchAlias,
		SearchRequest,
		SearchResult,
		TransientProjectionNode,
	} from "../domain/models";
	import type { InternalReferenceBacklink } from "../services/internal_reference_service";
	import type { UiVocabulary } from "../shared/ui_vocabulary";
	import type {
		CommandAvailability,
		CommandId,
	} from "./command_service";
	import IconButton from "./primitives/IconButton.svelte";
	import LinkEditor from "./LinkEditor.svelte";
	import SparseOutlineView from "./SparseOutlineView.svelte";

	const PERCENT_SCALE = 100;

	export type InspectorAsideMode = "overview" | "relation" | "history" | "query";
	type InspectorTab = Exclude<InspectorAsideMode, "query">;
	type InspectorCommands = Pick<
		Readonly<Record<CommandId, CommandAvailability>>,
		"addBookmark" | "createBranch" | "createLink" | "runQuery" | "saveQuery" | "startLongFormEditing"
	>;

	type InspectorQueryState = {
		ruleSource: string;
		ruleResult: RuleQueryResult | null;
		ruleName: string;
		ruleError: string;
		savedRuleQueries: readonly SavedRuleQuery[];
		sparseOutlineNodes: TransientProjectionNode[];
		sparseOutlineQueryName: string;
		showSparseOutline: boolean;
		aliases: readonly SearchAlias[];
		aliasCanonical: string;
		aliasVariants: string;
		onRuleSourceChange: (value: string) => void;
		onRuleNameChange: (value: string) => void;
		onAliasCanonicalChange: (value: string) => void;
		onAliasVariantsChange: (value: string) => void;
		onExecuteRule: () => void;
		onSaveRule: () => void;
		onLoadSavedQuery: (query: SavedRuleQuery) => void | Promise<void>;
		onRemoveRule: (id: string) => void | Promise<void>;
		onSaveAlias: () => void | Promise<void>;
		onRemoveAlias: (id: string) => void | Promise<void>;
		onSelectSparseNode: (node: TransientProjectionNode) => void | Promise<void>;
		onToggleSparseOutline: () => void;
	};

	let {
		asideMode,
		selectedItem,
		selectedPlacements,
		selectedLinks,
		selectedBranchId,
		recoverySnapshots,
		commands,
		vocabulary,
		inlineSemanticLinkNotice,
		internalReferenceBacklinks,
		internalReferenceNotice,
		emergenceSuggestions,
		emergenceResolutionReasons,
		emergenceLoading,
		query,
		onAsideModeChange,
		onElement,
		onStartResize,
		onAddBookmark,
		onSelectOccurrence,
		onSetInspectorCollapsed,
		onUpdateSelectedHeading,
		onSelectPlacement,
		showOutlineHint,
		onStartLongFormEditing,
		onConfirmLink,
		onDeleteLink,
		onReverseLink,
		onCompareLink,
		onSearch,
		titleFor,
		titleForId,
		titleForWork,
		formatCreatedAt,
		onOpenBacklink,
		onSetEmergenceReason,
		onResolveEmergence,
		onOpenWorkLineage,
		onOpenRevisionComparison,
		onCreateBranch,
	}: {
		asideMode: InspectorAsideMode;
		selectedItem: OutlineItem | null;
		selectedPlacements: readonly OutlineItem[];
		selectedLinks: readonly OutlineLink[];
		selectedBranchId: string | null;
		recoverySnapshots: readonly RecoverySnapshot[];
		commands: InspectorCommands;
		vocabulary: UiVocabulary;
		inlineSemanticLinkNotice: string;
		internalReferenceBacklinks: readonly InternalReferenceBacklink[];
		internalReferenceNotice: string;
		emergenceSuggestions: readonly EmergenceSuggestion[];
		emergenceResolutionReasons: Readonly<Record<string, string>>;
		emergenceLoading: boolean;
		query: InspectorQueryState;
		onAsideModeChange: (mode: InspectorAsideMode) => void;
		onElement: (element: HTMLElement | null) => void;
		onStartResize: (event: PointerEvent) => void;
		onAddBookmark: () => void;
		onSelectOccurrence: (id: string | null) => void;
		onSetInspectorCollapsed: (collapsed: boolean) => void;
		onUpdateSelectedHeading: (value: string) => void | Promise<void>;
		onSelectPlacement: (id: string) => void;
		showOutlineHint: boolean;
		onStartLongFormEditing: () => void;
		onConfirmLink: (input: CreateLinkInput) => void | Promise<void>;
		onDeleteLink: (link: OutlineLink) => void | Promise<void>;
		onReverseLink: (link: OutlineLink) => void | Promise<void>;
		onCompareLink: (link: OutlineLink) => void | Promise<void>;
		onSearch: (request: SearchRequest | string) => Promise<SearchResult[]>;
		titleFor: (item: OutlineItem) => string;
		titleForId: (id: string) => string;
		titleForWork: (id: string) => string;
		formatCreatedAt: (value: string) => string;
		onOpenBacklink: (backlink: InternalReferenceBacklink) => void | Promise<void>;
		onSetEmergenceReason: (id: string, value: string) => void;
		onResolveEmergence: (
			suggestion: EmergenceSuggestion,
			action: "accept" | "dismiss" | "pin",
		) => void | Promise<void>;
		onOpenWorkLineage: () => void;
		onOpenRevisionComparison: () => void;
		onCreateBranch: () => void | Promise<void>;
	} = $props();

	let inspectorElement: HTMLElement | null = null;

	onMount(() => {
		onElement(inspectorElement);
		return () => onElement(null);
	});

	const tabValue = $derived<InspectorTab>(asideMode === "query" ? "overview" : asideMode);

	function isInspectorTab(value: string): value is InspectorTab {
		return value === "overview" || value === "relation" || value === "history";
	}

	function handleTabChange(value: string): void {
		if (isInspectorTab(value)) onAsideModeChange(value);
	}
</script>

{#snippet queryTable(result: RuleQueryResult)}
	<div class="query-table"><table><thead><tr>{#each result.columns as column}<th>{column}</th>{/each}</tr></thead>
		<tbody>{#each result.rows as row}<tr>{#each row as value}<td>{titleForId(value)}</td>{/each}</tr>{/each}</tbody>
	</table></div>
{/snippet}

<aside bind:this={inspectorElement} class="inspector">
	<button
		class="inspector-resize-handle"
		type="button"
		aria-label="右ペインの幅を変更"
		onpointerdown={onStartResize}
		title="ドラッグして幅を変更"
	></button>
	{#if selectedItem && asideMode === "query"}
		<div class="query-panel">
			<label for="rule-source">読み取り専用Datalog</label>
			<textarea
				id="rule-source"
				rows="6"
				value={query.ruleSource}
				spellcheck="false"
				oninput={(event) => query.onRuleSourceChange(event.currentTarget.value)}
			></textarea>
			<div class="query-actions">
				<button type="button" onclick={query.onExecuteRule} disabled={!commands.runQuery.enabled} title={commands.runQuery.reason}>実行</button>
				<input
					placeholder="保存名"
					value={query.ruleName}
					oninput={(event) => query.onRuleNameChange(event.currentTarget.value)}
				/>
				<button type="button" onclick={query.onSaveRule} disabled={!commands.saveQuery.enabled} title={commands.saveQuery.reason}>保存</button>
			</div>
			{#if query.ruleError}<p class="query-error">{query.ruleError}</p>{/if}
			{#if query.ruleResult}
				<p class="query-meta">{query.ruleResult.rows.length}件・{query.ruleResult.elapsedMs.toFixed(1)}ms</p>
				{#if query.sparseOutlineNodes.length}
					<div class="sparse-outline-section">
						<div class="sparse-outline-header">
							<h3>{vocabulary.sparseOutline}<small>{query.sparseOutlineQueryName}</small></h3>
							<button class="sparse-toggle" type="button" onclick={query.onToggleSparseOutline}>
								{query.showSparseOutline ? "テーブル表示" : "投影表示"}
							</button>
						</div>
						{#if query.showSparseOutline}
							<SparseOutlineView nodes={query.sparseOutlineNodes} onSelectNode={query.onSelectSparseNode} />
						{:else}
							{@render queryTable(query.ruleResult)}
						{/if}
					</div>
				{:else}
					{@render queryTable(query.ruleResult)}
				{/if}
			{/if}
			<div class="saved-queries">
				{#each query.savedRuleQueries as saved}
					<button type="button" onclick={() => void query.onLoadSavedQuery(saved)}>{saved.name}</button>
					<IconButton class="remove-saved" label={`${saved.name}を削除`} onclick={() => void query.onRemoveRule(saved.id)}>×</IconButton>
				{/each}
			</div>
			<h3>検索別名</h3>
			<input
				placeholder="基準語"
				value={query.aliasCanonical}
				oninput={(event) => query.onAliasCanonicalChange(event.currentTarget.value)}
			/>
			<textarea
				rows="2"
				placeholder="別名（カンマ区切り）"
				value={query.aliasVariants}
				oninput={(event) => query.onAliasVariantsChange(event.currentTarget.value)}
			></textarea>
			<button type="button" onclick={() => void query.onSaveAlias()}>別名を追加</button>
			<div class="alias-list">
				{#each query.aliases as alias}
					<div>
						<span>{alias.canonical} ↔ {alias.variants.join(", ")}</span>
						<IconButton label={`「${alias.canonical}」の検索別名を削除`} onclick={() => void query.onRemoveAlias(alias.id)}>×</IconButton>
					</div>
				{/each}
			</div>
		</div>
	{:else if selectedItem}
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
				<h2>{titleFor(selectedItem)}</h2>
				<div class="inspector-heading-actions">
					<button class="inspector-action" type="button" onclick={onAddBookmark} disabled={!commands.addBookmark.enabled} title={commands.addBookmark.reason}>☆ {vocabulary.bookmark}</button>
				</div>
			</div>
			<Tabs.Content value="overview">
				{#snippet child({ props })}
					<div {...props}>
						<label>
							{vocabulary.occurrence}固有の見出し
							<input
								value={selectedItem.contextualHeading ?? ""}
								onchange={(event) => void onUpdateSelectedHeading(event.currentTarget.value)}
								placeholder="未設定時は本文の先頭行"
							/>
						</label>
						<section class="placements">
							<h3>すべての{vocabulary.occurrence}<small>{selectedPlacements.length}件</small></h3>
							<div>
								{#each selectedPlacements as placement (placement.id)}
									<button type="button" class:active={placement.id === selectedItem.id} onclick={() => onSelectPlacement(placement.id)}>
										<strong>{titleFor(placement)}</strong>
										<span>{placement.parentId ? `親: ${titleForId(placement.parentId)}` : "ルート"}</span>
									</button>
								{/each}
							</div>
						</section>
						<div class="discovery-actions">
							<button type="button" onclick={onStartLongFormEditing} disabled={!commands.startLongFormEditing.enabled} title={commands.startLongFormEditing.reason}>長文編集</button>
						</div>
						<div class="thought-meta">
							<div><span class="meta-label">作成日</span><time datetime={selectedItem.createdAt}>{formatCreatedAt(selectedItem.createdAt)}</time></div>
							<div><span class="meta-label">更新日</span><time datetime={selectedItem.updatedAt}>{formatCreatedAt(selectedItem.updatedAt)}</time></div>
							{#if selectedItem.parentId}
								<div><span class="meta-label">親</span><span>{titleForId(selectedItem.parentId)}</span></div>
							{/if}
						</div>
						{#if showOutlineHint}<p class="hint">Enter: 兄弟　Shift+Enter: 改行<br />Tab / Shift+Tab: 階層　Alt+↑↓: 移動</p>{/if}
					</div>
				{/snippet}
			</Tabs.Content>
			<Tabs.Content value="relation">
				{#snippet child({ props })}
					<div {...props}>
						<LinkEditor
							selectedWorkId={selectedItem.workId}
							selectedDisplayName={titleFor(selectedItem)}
							links={selectedLinks}
							titleForWork={titleForWork}
							onConfirm={onConfirmLink}
							onDelete={onDeleteLink}
							onReverse={onReverseLink}
							onCompare={onCompareLink}
							onSearch={onSearch}
						/>
						{#if inlineSemanticLinkNotice}<p class="inline-semantic-link-notice" role="status">{inlineSemanticLinkNotice}</p>{/if}
						<section class="internal-reference-backlinks">
							<h3>{vocabulary.backlink}<small>{internalReferenceBacklinks.length}件</small></h3>
							{#each internalReferenceBacklinks as backlink (JSON.stringify(backlink.source))}
								<button type="button" onclick={() => void onOpenBacklink(backlink)}>
									<strong>{backlink.displayName}</strong>
									<span>{backlink.source.scope === "work" ? vocabulary.workingCopy : `固定${vocabulary.revision}`} · {backlink.count}箇所</span>
								</button>
							{:else}
								<p class="empty">{vocabulary.backlink}はありません</p>
							{/each}
						</section>
						{#if internalReferenceNotice}<p class="internal-reference-notice" role="status">{internalReferenceNotice}</p>{/if}
						<div class="discoveries">
							{#if emergenceLoading}<p class="empty">{vocabulary.emergenceLoading}</p>{/if}
							{#each emergenceSuggestions as suggestion}
								<article class:pinned={suggestion.status === "pinned"}>
									<div class="discovery-title"><span>{suggestion.title}</span><small>{Math.round(suggestion.score * PERCENT_SCALE)}%</small></div>
									<strong>{titleForId(suggestion.targetItemId)}</strong>
									<p>{suggestion.explanation}</p>
									<ol>{#each suggestion.evidence as step}<li>{step.relation}: {titleForId(step.fromId)} → {titleForId(step.toId)}</li>{/each}</ol>
									<input
										aria-label={vocabulary.emergenceResolutionReason}
										placeholder={vocabulary.emergenceResolutionReason}
										value={emergenceResolutionReasons[suggestion.id] ?? ""}
										oninput={(event) => onSetEmergenceReason(suggestion.id, event.currentTarget.value)}
									/>
									<div class="discovery-actions">
										<button type="button" onclick={() => void onResolveEmergence(suggestion, "accept")}>{vocabulary.emergenceAccept}</button>
										<button type="button" onclick={() => void onResolveEmergence(suggestion, "pin")}>{vocabulary.emergenceHold}</button>
										<button type="button" onclick={() => void onResolveEmergence(suggestion, "dismiss")} disabled={!emergenceResolutionReasons[suggestion.id]?.trim()}>{vocabulary.emergenceDismiss}</button>
									</div>
								</article>
							{:else}
								{#if !emergenceLoading}<p class="empty">{vocabulary.noEmergenceSuggestion}</p>{/if}
							{/each}
						</div>
					</div>
				{/snippet}
			</Tabs.Content>
			<Tabs.Content value="history">
				{#snippet child({ props })}
					<div {...props}>
						<div class="history-panel">
							<p class="hint">選択中の{vocabulary.work}に従属する履歴です。</p>
							<button type="button" onclick={() => void onCreateBranch()} disabled={!commands.createBranch.enabled} title={commands.createBranch.reason}>新しい{vocabulary.branch}を作る</button>
							<button type="button" onclick={onOpenWorkLineage} disabled={!selectedItem}>{vocabulary.workLineage}を開く</button>
							<button type="button" onclick={onOpenRevisionComparison} disabled={!selectedItem}>{vocabulary.revision}{vocabulary.comparisonPane}を開く</button>
							{#if selectedBranchId}
								<button type="button" onclick={onOpenWorkLineage}>Recovery snapshotsを開く</button>
								<small>{recoverySnapshots.length}件のRecovery snapshot</small>
							{:else}
								<small>Recoveryは{vocabulary.branch}を選択すると利用できます。</small>
							{/if}
						</div>
					</div>
				{/snippet}
			</Tabs.Content>
		</Tabs.Root>
	{:else}
		<div class="aside-empty">
			<button class="inspector-close" type="button" onclick={() => onSetInspectorCollapsed(true)}>閉じる</button>
			<span>•</span><p>{vocabulary.work}を選択すると<br />関連{vocabulary.semanticLink}を編集できます</p>
		</div>
	{/if}
</aside>
