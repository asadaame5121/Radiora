<script lang="ts">
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";
	import type { ViewMode } from "./app_view_mode.ts";

	export type RecentNavigationItem = {
		workId: string;
		id: string;
		title: string;
		parentLabel: string;
		editedAtLabel: string;
	};

	let {
		collapsed,
		activeView,
		queryActive,
		queryAvailable,
		recentItems,
		selectedId,
		onToggleCollapse,
		onOpenToday,
		onOpenUnplaced,
		onOpenStubs,
		onOpenDuplicates,
		onOpenOptions,
		onOpenTags,
		onOpenQuery,
		onOpenHelp,
		onOpenRecentItem,
	}: {
		collapsed: boolean;
		activeView: ViewMode;
		queryActive: boolean;
		queryAvailable: boolean;
		recentItems: RecentNavigationItem[];
		selectedId: string | null;
		onToggleCollapse: () => void;
		onOpenToday: () => void | Promise<void>;
		onOpenUnplaced: () => void | Promise<void>;
		onOpenStubs: () => void | Promise<void>;
		onOpenDuplicates: () => void | Promise<void>;
		onOpenOptions: () => void;
		onOpenTags: () => void | Promise<void>;
		onOpenQuery: () => void | Promise<void>;
		onOpenHelp: () => void;
		onOpenRecentItem: (item: RecentNavigationItem) => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
</script>

<nav class="primary-nav" class:nav-collapsed={collapsed} aria-label="主な画面">
	<button
		class="nav-collapse-toggle"
		type="button"
		aria-label={collapsed ? "ナビゲーションを開く" : "ナビゲーションを閉じる"}
		aria-expanded={!collapsed}
		title={collapsed ? "ナビゲーションを開く" : "ナビゲーションを閉じる"}
		onclick={onToggleCollapse}
	>{collapsed ? "»" : "«"}</button>
	<div class="brand"><strong>Radiora</strong><span>v2</span></div>
	<section>
		<p>作業</p>
		<button type="button" class:active={activeView === "today"} aria-pressed={activeView === "today"}
			onclick={onOpenToday}>{vocabulary.today}</button>
		<button type="button" class:active={activeView === "unplaced"} aria-pressed={activeView === "unplaced"}
			onclick={onOpenUnplaced}>{vocabulary.unplacedInbox}</button>
		<button type="button" class:active={activeView === "stubs"} aria-pressed={activeView === "stubs"}
			onclick={onOpenStubs}>{vocabulary.stubList}</button>
	</section>
	<section class="recent-edits" aria-labelledby="recent-edits-heading">
		<p id="recent-edits-heading">最近編集した{vocabulary.work}</p>
		{#each recentItems as item (item.workId)}
			<button
				type="button"
				class:active={activeView === "outline" && selectedId === item.id}
				onclick={() => void onOpenRecentItem(item)}
			>
				<strong>{item.title}</strong>
				<small>{item.parentLabel} · {item.editedAtLabel}</small>
			</button>
		{:else}
			<span class="nav-empty">編集した{vocabulary.work}はありません</span>
		{/each}
	</section>
	<section>
		<p>探索</p>
		<button type="button" class:active={activeView === "duplicates"} aria-pressed={activeView === "duplicates"}
			onclick={onOpenDuplicates}>{vocabulary.duplicateCandidates}</button>
	</section>
	<section class="nav-tools">
		<p>ツール</p>
		<button type="button" class:active={activeView === "tags"} onclick={onOpenTags}>{vocabulary.tag}管理</button>
		<button type="button" class:active={queryActive} onclick={onOpenQuery}
			disabled={!queryAvailable}>Query・検索別名</button>
		<div class="nav-icon-row" aria-label="設定とヘルプ">
			<button type="button" class:active={activeView === "options" || activeView === "trash"}
				aria-pressed={activeView === "options" || activeView === "trash"} aria-label="Option" title="Option"
				onclick={onOpenOptions}>⚙</button>
			<button type="button" class:active={activeView === "help"} aria-pressed={activeView === "help"}
				aria-label="ヘルプ" title="ヘルプ (F1)" onclick={onOpenHelp}>?</button>
		</div>
	</section>
</nav>

<style>
	.primary-nav {
		grid-column: 1;
		grid-row: 1 / -1;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 100vh;
		padding: 16px 11px;
		border-right: 1px solid var(--border);
		background: rgb(5 10 16 / 97%);
	}
	.primary-nav .brand {
		min-width: 0;
		padding: 0 8px 12px;
		border-bottom: 1px solid var(--border);
	}
	.primary-nav .brand strong {
		font-family: var(--font-serif);
		font-size: 20px;
		letter-spacing: .08em;
	}
	.primary-nav .brand span {
		margin-left: 8px;
		color: var(--muted);
		font-size: 9px;
	}
	.primary-nav section {
		display: grid;
		gap: 3px;
	}
	.primary-nav section > p {
		margin: 0 7px 4px;
		color: var(--muted);
		font-size: 9px;
		letter-spacing: .16em;
	}
	.primary-nav .recent-edits {
		max-height: min(34vh, 280px);
		overflow: auto;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}
	.primary-nav .recent-edits button {
		display: grid;
		gap: 3px;
		min-width: 0;
		padding-block: 6px;
	}
	.recent-edits strong,
	.recent-edits small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recent-edits strong {
		font-size: 11px;
		font-weight: normal;
		color: var(--text);
	}
	.recent-edits small,
	.nav-empty {
		padding-inline: 9px;
		color: var(--muted);
		font-size: 9px;
	}
	.primary-nav button,
	.primary-nav button:hover,
	.primary-nav button.active {
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 7px 9px;
		background: transparent;
		color: #aebdc5;
		text-align: left;
		cursor: pointer;
	}
	.primary-nav button:hover,
	.primary-nav button.active {
		border-color: var(--border);
		background: var(--surface-hover);
		color: var(--text);
	}
	.primary-nav button.active {
		box-shadow: inset 2px 0 var(--cyan);
		color: var(--cyan-soft);
	}
	.primary-nav button:disabled {
		opacity: .4;
		cursor: not-allowed;
	}
	.primary-nav .nav-tools {
		margin-top: auto;
	}
	.primary-nav .nav-collapse-toggle {
		flex: 0 0 auto;
		align-self: flex-start;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		padding: 0;
		font-size: 14px;
		line-height: 1;
		text-align: center;
	}
	.primary-nav.nav-collapsed {
		padding: 12px 3px;
		gap: 0;
		align-items: stretch;
	}
	.primary-nav.nav-collapsed .brand,
	.primary-nav.nav-collapsed section {
		display: none;
	}
	.primary-nav.nav-collapsed .nav-collapse-toggle {
		width: 36px;
		height: 36px;
	}
	.primary-nav .nav-icon-row {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.primary-nav .nav-icon-row button {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		font-size: 16px;
		text-align: center;
	}
	@media (max-width: 820px) {
		.primary-nav {
			padding-inline: 7px;
		}
		.primary-nav .brand {
			padding-inline: 2px;
		}
		.primary-nav .brand strong {
			font-size: 12px;
		}
		.primary-nav .brand span,
		.primary-nav section > p {
			display: none;
		}
		.primary-nav button {
			padding-inline: 5px;
			font-size: 9px;
			text-align: center;
			overflow-wrap: anywhere;
		}
	}
</style>
