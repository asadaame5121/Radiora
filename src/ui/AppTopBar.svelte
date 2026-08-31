<script lang="ts">
	import type { Bookmark, OutlineItem, SearchResult } from "../domain/models.ts";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import WorkingCopySaveStatus from "./WorkingCopySaveStatus.svelte";
	import type { WorkingCopySaveStatus as WorkingCopySaveStatusValue } from "../services/working_copy_autosave.ts";
	import type { CommandId } from "./command_service.ts";
	import ThemeSwitcher from "./ThemeSwitcher.svelte";
	import type { ThemePreference } from "./theme_preference.ts";

	let {
		viewMode,
		viewModeLabel,
		quickCaptureText,
		quickCaptureDestinationLabel,
		quickCaptureSubmitting,
		startupPhase,
		searchActiveIndex,
		suggestions,
		searchResults,
		searchEntriesLength,
		commands,
		vocabulary,
		bookmarks,
		inspectorCollapsed,
		workingCopySaveStatus,
		themePreference = "auto",
		onSetViewMode,
		onQuickCaptureInput,
		onQuickCaptureKeydown,
		onSelectSuggestion,
		onSelectSearch,
		onExecuteCommand,
		onResumeEditing,
		onOpenBookmark,
		onRemoveBookmark,
		onToggleInspector,
		onRetryWorkingCopySave,
		onThemePreferenceChange,
		titleFor,
	}: {
		viewMode: string;
		viewModeLabel: string;
		quickCaptureText: string;
		quickCaptureDestinationLabel: string;
		quickCaptureSubmitting: boolean;
		startupPhase: string;
		searchActiveIndex: number;
		suggestions: readonly { item: OutlineItem; title: string; ancestorIds?: string[] }[];
		searchResults: readonly SearchResult[];
		searchEntriesLength: number;
		commands: Readonly<Record<string, { enabled: boolean; reason?: string }>>;
		vocabulary: UiVocabulary;
		bookmarks: readonly Bookmark[];
		inspectorCollapsed: boolean;
		workingCopySaveStatus: WorkingCopySaveStatusValue | null;
		themePreference?: ThemePreference;
		onSetViewMode: (mode: "outline" | "globalLineage") => void;
		onQuickCaptureInput: (text: string) => void;
		onQuickCaptureKeydown: (event: KeyboardEvent) => void;
		onSelectSuggestion: (item: OutlineItem, ancestorIds?: string[]) => void;
		onSelectSearch: (result: SearchResult) => void;
		onExecuteCommand: (commandId: CommandId) => void;
		onResumeEditing: () => void;
		onOpenBookmark: (id: string) => void;
		onRemoveBookmark: (id: string) => void;
		onToggleInspector: () => void;
		onRetryWorkingCopySave: () => void;
		onThemePreferenceChange?: (preference: ThemePreference) => void;
		titleFor: (item: OutlineItem) => string;
	} = $props();

	const BOOKMARK_PREFIX_LENGTH = 4;
</script>

<header class="top-bar">
	<div class="current-location">
		<fieldset class="view-switcher" aria-label="アウトラインとツリー">
			<button
				type="button"
				class:active={viewMode === "outline"}
				aria-pressed={viewMode === "outline"}
				onclick={() => onSetViewMode("outline")}
			>アウトライン</button>
			<button
				type="button"
				class:active={viewMode === "globalLineage"}
				aria-pressed={viewMode === "globalLineage"}
				onclick={() => onSetViewMode("globalLineage")}
			>ツリー</button>
		</fieldset>
		{#if viewMode !== "outline" && viewMode !== "globalLineage"}
			<small class="current-location__status">表示中: {viewModeLabel}</small>
		{/if}
	</div>
	<form class="omniwindow" onsubmit={(event) => event.preventDefault()}>
		<input
			role="combobox"
			aria-label={`検索・${vocabulary.quickCapture}`}
			placeholder={`思索を検索、Shift+Enterで${quickCaptureDestinationLabel}へ作成…`}
			value={quickCaptureText}
			oninput={(event) => onQuickCaptureInput(event.currentTarget.value)}
			onkeydown={onQuickCaptureKeydown}
			autocomplete="off"
			disabled={startupPhase !== "ready" || quickCaptureSubmitting}
			aria-autocomplete="list"
			aria-haspopup="listbox"
			aria-expanded={Boolean(quickCaptureText.trim())}
			aria-controls={quickCaptureText.trim() ? "omniwindow-search-results" : undefined}
			aria-activedescendant={searchActiveIndex >= 0 ? `omni-option-${searchActiveIndex}` : undefined}
		/>
		{#if quickCaptureText.trim()}
			<div id="omniwindow-search-results" class="search-results" role="listbox" aria-label="検索と新規作成の候補">
				{#if suggestions.length}<p class="search-section">タイトル</p>{/if}
				{#each suggestions as suggestion, index}
					<button
						id={`omni-option-${index}`}
						type="button"
						role="option"
						aria-selected={searchActiveIndex === index}
						class:active={searchActiveIndex === index}
						onclick={() => onSelectSuggestion(suggestion.item, suggestion.ancestorIds)}
					>
						<strong>{suggestion.title || `(空の${vocabulary.work})`}</strong>
						<small>先頭一致</small>
					</button>
				{/each}
				{#if searchResults.length}<p class="search-section">本文・関連</p>{/if}
				{#each searchResults as result, index}
					<button
						id={`omni-option-${suggestions.length + index}`}
						type="button"
						role="option"
						aria-selected={searchActiveIndex === suggestions.length + index}
						class:active={searchActiveIndex === suggestions.length + index}
						onclick={() => onSelectSearch(result)}
					>
						<strong>{titleFor(result.item)}</strong>
						<small>{result.reasons.map((reason: { label: string }) => reason.label).slice(0, 2).join(" · ")}</small>
					</button>
				{/each}
				<p class="search-section">新規作成</p>
				<button
					id={`omni-option-${searchEntriesLength}`}
					type="button"
					role="option"
					class="create-candidate"
					aria-selected={searchActiveIndex === searchEntriesLength}
					class:active={searchActiveIndex === searchEntriesLength}
					disabled={!commands.quickCapture?.enabled}
					title={commands.quickCapture?.reason}
					onclick={() => onExecuteCommand("quickCapture")}
				>
					<strong>「{quickCaptureText.trim()}」を{quickCaptureDestinationLabel}へ作成</strong>
					<small>Shift+Enter</small>
				</button>
			</div>
		{/if}
	</form>
	<div class="top-actions">
		<div class="toolbar-group toolbar-nav" role="toolbar" aria-label="ナビゲーション">
			<button type="button" onclick={onResumeEditing}>{vocabulary.resumePosition}から再開</button>
		</div>
		{#each bookmarks as bookmark}
			<span class="bookmark-control">
				<button type="button" onclick={() => onOpenBookmark(bookmark.id)}>{vocabulary.bookmark} {bookmark.id.slice(0, BOOKMARK_PREFIX_LENGTH)}</button>
				<button type="button" aria-label={`${vocabulary.bookmark}を削除`} onclick={() => onRemoveBookmark(bookmark.id)}>×</button>
			</span>
		{/each}
		{#if onThemePreferenceChange}
			<ThemeSwitcher {themePreference} {onThemePreferenceChange} />
		{/if}
		<button
			class="inspector-jump"
			type="button"
			aria-expanded={!inspectorCollapsed}
			aria-label={inspectorCollapsed ? "インスペクターペインを開く" : "インスペクターペインを閉じる"}
			title={inspectorCollapsed ? "インスペクターペインを開く" : "インスペクターペインを閉じる"}
			onclick={onToggleInspector}
		>{inspectorCollapsed ? "«" : "»"}</button>
	</div>
	{#if workingCopySaveStatus}
		<WorkingCopySaveStatus status={workingCopySaveStatus} onRetry={onRetryWorkingCopySave} />
	{/if}
</header>

<style>
	.top-bar {
		grid-column: 2;
		grid-row: 1;
		position: relative;
		z-index: 20;
		height: 66px;
		display: grid;
		grid-template-columns: minmax(190px, 230px) minmax(280px, 680px) minmax(180px, auto);
		justify-content: stretch;
		align-items: center;
		gap: 16px;
		padding: 0 20px;
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(14px);
	}
	.current-location {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.current-location__status {
		color: var(--muted);
		font-size: 9px;
		white-space: nowrap;
	}
	.view-switcher {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		width: 100%;
		min-width: 180px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.view-switcher button {
		border: 0;
		border-radius: 5px;
		padding: 7px 18px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		transition: background .16s ease, color .16s ease, box-shadow .16s ease;
	}
	.view-switcher button:hover {
		color: var(--text);
	}
	.view-switcher button.active {
		background: var(--cyan);
		color: var(--cyan-fg, var(--bg));
		box-shadow: 0 0 18px color-mix(in srgb, var(--cyan) 18%, transparent);
	}
	.view-switcher button:disabled {
		cursor: not-allowed;
		opacity: .35;
	}
	.omniwindow {
		position: relative;
		align-self: center;
		width: 100%;
	}
	.omniwindow > input {
		width: 100%;
		border: 1px solid var(--border-bright);
		border-radius: 9px;
		padding: 10px 13px;
		background: var(--surface);
		color: var(--text);
		outline: none;
	}
	.omniwindow > input:focus {
		border-color: var(--cyan);
		box-shadow: 0 0 0 2px rgb(37 198 209 / 12%);
	}
	.search-results {
		position: absolute;
		inset: calc(100% + 6px) 0 auto;
		z-index: 10;
		max-height: 300px;
		overflow: auto;
		background: var(--surface-raised);
		border: 1px solid var(--border-bright);
		border-radius: 8px;
		box-shadow: 0 16px 40px #000a;
	}
	.search-results button {
		display: grid;
		gap: 3px;
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--border);
		padding: 10px 12px;
		text-align: left;
		background: transparent;
		cursor: pointer;
	}
	.search-results button:hover,
	.search-results button.active {
		background: var(--surface-hover);
	}
	.search-results button strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
	}
	.search-results button small {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 9px;
	}
	.search-section {
		margin: 0;
		padding: 7px 12px;
		background: var(--surface-raised);
		color: var(--cyan);
		font-size: 8px;
		letter-spacing: .15em;
		text-transform: uppercase;
	}
	.search-results .create-candidate {
		color: var(--cyan-soft);
	}
	.top-actions {
		display: flex;
		align-items: center;
		justify-content: end;
		gap: 4px;
		min-width: 0;
		overflow-x: auto;
	}
	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.top-actions button {
		flex: 0 0 auto;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 6px 8px;
		background: transparent;
		color: var(--muted);
		font-size: 10px;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}
	.top-actions button:hover {
		border-color: var(--border);
		background: var(--surface-hover);
		color: var(--text);
	}
	.bookmark-control {
		display: inline-flex;
		margin: 0;
	}
	.bookmark-control button + button {
		padding-inline: 4px;
	}
	.inspector-jump {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		font-size: 14px;
	}
	@media (max-width: 1120px) {
		.top-bar {
			grid-template-columns: minmax(180px, 210px) minmax(260px, 1fr) auto;
			padding-inline: 12px;
			gap: 8px;
		}
		.top-actions .bookmark-control {
			display: none;
		}
	}
	@media (max-width: 820px) {
		.top-bar {
			grid-template-columns: minmax(170px, 190px) minmax(220px, 1fr) auto;
		}
		.current-location__status {
			display: none;
		}
		.top-actions > button:not(.inspector-jump),
		.top-actions .bookmark-control {
			display: none;
		}
		.inspector-jump {
			display: grid;
		}
	}
</style>
