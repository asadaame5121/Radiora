<script lang="ts">
	import { LINK_TYPES, type LinkType, type UnplacedWork } from "../domain/models.ts";
	import {
		matchesOutlineFilter,
		type OutlineFilter,
	} from "../services/outline_filter.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	type LinkableWork = {
		workId: string;
		text: string;
	};

	let {
		works,
		linkableWorks,
		selectedId,
		outlineFilter = $bindable(),
		unplacedLinkTargets = $bindable(),
		unplacedLinkDirections = $bindable(),
		unplacedLinkType = $bindable(),
		onUpdateText,
		onPlace,
		onLink,
		onClearFilter,
		formatCreatedAt,
	}: {
		works: UnplacedWork[];
		linkableWorks: LinkableWork[];
		selectedId: string | null;
		outlineFilter: OutlineFilter;
		unplacedLinkTargets: Record<string, string>;
		unplacedLinkDirections: Record<string, "from" | "to">;
		unplacedLinkType: LinkType;
		onUpdateText: (work: UnplacedWork, text: string) => void | Promise<void>;
		onPlace: (workId: string, parentId: string | null) => void | Promise<void>;
		onLink: (workId: string) => void | Promise<void>;
		onClearFilter: () => void;
		formatCreatedAt: (value: string) => string;
	} = $props();

	const vocabulary = useUiVocabulary();
	const filteredWorks = $derived(
		works.filter((work) => matchesOutlineFilter(work.text, outlineFilter)),
	);
</script>

<section class="outline-panel unplaced-inbox" aria-label={vocabulary.unplacedInbox}>
	<div class="section-title">
		<span>{vocabulary.unplacedInbox}</span><small>{filteredWorks.length}件{#if filteredWorks.length !== works.length} / {works.length}件{/if}</small>
	</div>
	<p class="hint">
		配置先を決めずに保存した、本文のある{vocabulary.work}です。本文へ #タグ を入力するとタグ付けできます。
		本文未記入の{vocabulary.stub}は{vocabulary.stubList}で管理します。
	</p>
	<p class="filter-hint">自由語は部分一致 · タグはすべて含む（AND） · NOTタグは除外 · この表示だけに適用</p>
	<div class="filter-bar">
		<input
			class="filter-input"
			aria-label="テキストで絞り込み"
			placeholder="テキストで絞り込み…"
			bind:value={outlineFilter.freeText}
		/>
		<input
			class="filter-input"
			aria-label="タグ AND"
			placeholder="#タグ AND"
			bind:value={outlineFilter.tagsAll}
		/>
		<input
			class="filter-input"
			aria-label="タグ NOT"
			placeholder="#除外 NOT"
			bind:value={outlineFilter.tagsNone}
		/>
		<button onclick={onClearFilter} disabled={!outlineFilter.freeText && !outlineFilter.tagsAll && !outlineFilter.tagsNone}>解除</button>
	</div>
	<div class="unplaced-list">
		{#each filteredWorks as work (work.workId)}
			<article class="unplaced-entry">
				<textarea
					rows="3"
					aria-label={`${vocabulary.workingCopy}を編集`}
					value={work.text}
					onchange={(event) => onUpdateText(work, event.currentTarget.value)}
				></textarea>
				<small>{formatCreatedAt(work.createdAt)}</small>
				<div class="unplaced-actions">
					<button onclick={() => onPlace(work.workId, null)}>Rootへ配置</button>
					<button
						onclick={() => onPlace(work.workId, selectedId)}
						disabled={!selectedId}
					>選択中の{vocabulary.occurrence}の下へ配置</button>
				</div>
				<div class="unplaced-actions">
					<select
						aria-label={`${vocabulary.semanticLink}の方向`}
						value={unplacedLinkDirections[work.workId] ?? "from"}
						onchange={(event) =>
							unplacedLinkDirections[work.workId] = event.currentTarget.value as "from" | "to"}
					>
						<option value="from">この{vocabulary.work}から</option>
						<option value="to">この{vocabulary.work}へ</option>
					</select>
					<select
						aria-label={`${vocabulary.semanticLink}相手`}
						value={unplacedLinkTargets[work.workId] ?? ""}
						onchange={(event) => unplacedLinkTargets[work.workId] = event.currentTarget.value}
					>
						<option value="">相手を選択…</option>
						{#each linkableWorks.filter((candidate) => candidate.workId !== work.workId) as target}
							<option value={target.workId}>{target.text.split("\n")[0] || `(空の${vocabulary.work})`}</option>
						{/each}
					</select>
					<select aria-label={`${vocabulary.semanticLink}種別`} bind:value={unplacedLinkType}>
						{#each LINK_TYPES as type}<option value={type}>{type}</option>{/each}
					</select>
					<button onclick={() => onLink(work.workId)}>{vocabulary.semanticLink}作成</button>
				</div>
			</article>
		{:else}
			<p class="empty">{vocabulary.unplacedInbox}は空です。</p>
		{/each}
	</div>
</section>

<style>
	.unplaced-inbox {
		display: grid;
		gap: 16px;
	}
	.unplaced-list {
		display: grid;
		gap: 12px;
		margin-top: 12px;
	}
	.unplaced-entry {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.unplaced-entry textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-raised);
		color: var(--text);
		font-family: inherit;
		resize: vertical;
	}
	.unplaced-entry small {
		color: var(--muted);
		font-size: 10px;
	}
	.unplaced-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.unplaced-actions select,
	.unplaced-actions button {
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 6px 10px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 11px;
	}
	.unplaced-actions button {
		cursor: pointer;
	}
	.unplaced-actions button:disabled {
		opacity: .4;
		cursor: not-allowed;
	}
</style>
