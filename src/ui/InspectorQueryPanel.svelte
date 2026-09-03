<script lang="ts">
	import type { RuleQueryResult, SavedRuleQuery, SearchAlias, TransientProjectionNode } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type { CommandAvailability, CommandId } from "./command_service.ts";
	import IconButton from "./primitives/IconButton.svelte";
	import SparseOutlineView from "./SparseOutlineView.svelte";

	type InspectorCommands = Pick<
		Readonly<Record<CommandId, CommandAvailability>>,
		"runQuery" | "saveQuery"
	>;

	export type InspectorQueryState = {
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
		query,
		vocabulary,
		commands,
		titleForId,
	}: {
		query: InspectorQueryState;
		vocabulary: UiVocabulary;
		commands: InspectorCommands;
		titleForId: (id: string) => string;
	} = $props();
</script>

{#snippet queryTable(result: RuleQueryResult)}
	<div class="query-table">
		<table>
			<thead>
				<tr>{#each result.columns as column}<th>{column}</th>{/each}</tr>
			</thead>
			<tbody>
				{#each result.rows as row}
					<tr>{#each row as value}<td>{titleForId(value)}</td>{/each}</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

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
						{query.showSparseOutline ? "テーブル表示" : vocabulary.sparseOutline}
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
	<button type="button" class="alias-add-btn" onclick={() => void query.onSaveAlias()}>別名を追加</button>
	<div class="alias-list">
		{#each query.aliases as alias}
			<div>
				<span>{alias.canonical} ↔ {alias.variants.join(", ")}</span>
				<IconButton label={`「${alias.canonical}」の検索別名を削除`} onclick={() => void query.onRemoveAlias(alias.id)}>×</IconButton>
			</div>
		{/each}
	</div>
</div>

<style>
	.query-panel {
		display: grid;
		gap: 8px;
	}
	.query-panel label,
	.query-panel h3 {
		color: var(--cyan);
		font-size: 10px;
		letter-spacing: .1em;
	}
	.query-panel textarea,
	.query-panel input {
		width: 100%;
		border: 1px solid var(--border-bright);
		border-radius: 6px;
		padding: 6px 8px;
		background: var(--theme-surface-raised, #02060a);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 10px;
		resize: vertical;
	}
	.query-actions {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 5px;
	}
	.query-actions button,
	.alias-add-btn {
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 4px 8px;
		background: var(--surface-raised);
		color: var(--text);
		cursor: pointer;
		font-size: 10px;
	}
	.query-error {
		margin: 0;
		color: var(--theme-red, #ff9f92);
		font-size: 10px;
		white-space: pre-wrap;
	}
	.query-meta {
		margin: 0;
		color: var(--muted);
		font-size: 9px;
	}
	.query-table {
		max-height: 180px;
		overflow: auto;
		border: 1px solid var(--border);
	}
	.query-table table {
		width: 100%;
		border-collapse: collapse;
		font-size: 9px;
	}
	.query-table th,
	.query-table td {
		padding: 5px;
		border-bottom: 1px solid var(--border);
		text-align: left;
	}
	.saved-queries {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px;
	}
	.saved-queries button {
		text-align: left;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 4px 6px;
		background: var(--surface-hover);
		color: var(--muted);
		font-size: 10px;
		cursor: pointer;
	}
	:global(.saved-queries .remove-saved) {
		color: var(--muted);
	}
	.sparse-outline-section {
		margin: 8px 0;
	}
	.sparse-outline-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	.sparse-outline-header h3 {
		margin: 0;
		font-size: 12px;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sparse-outline-header h3 small {
		font-size: 10px;
		color: var(--muted);
		font-weight: 400;
	}
	.sparse-toggle {
		border: 1px solid var(--border);
		background: var(--surface-raised);
		color: var(--muted);
		padding: 2px 8px;
		border-radius: 3px;
		font-size: 10px;
		cursor: pointer;
	}
	.sparse-toggle:hover {
		color: var(--text);
		border-color: var(--border-bright);
	}
	.alias-list {
		display: grid;
		gap: 4px;
	}
	.alias-list div {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px;
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--theme-muted, #9aadb6);
		font-size: 9px;
	}
</style>
