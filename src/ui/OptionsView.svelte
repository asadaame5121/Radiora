<script lang="ts">
	import type { MarkdownExportPreference } from "./markdown_export_preference.ts";
	import type { QuickCapturePreference } from "./quick_capture_preference.ts";
	import type { TreeProjection } from "./tree_layout.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		markdownExportPreference = $bindable<MarkdownExportPreference>(),
		quickCapturePreference = $bindable<QuickCapturePreference>(),
		markdownExportEnabled,
		markdownExportReason,
		markdownExportSelectionRequired,
		markdownExportNotice,
		startupReady,
		opmlNotice,
		jsonBackupNotice,
		treeProjectionPreference,
		navCollapsed,
		inspectorCollapsed,
		inspectorWidth,
		onPersistMarkdownExportPreference,
		onExportMarkdown,
		onImportOpml,
		onExportOpml,
		onExportJsonBackup,
		onRestoreJsonBackup,
		onTreeProjectionChange,
		onNavigationCollapsedChange,
		onInspectorCollapsedChange,
		onInspectorWidthChange,
		onPersistQuickCapturePreference,
		onOpenLicenses,
	}: {
		markdownExportPreference: MarkdownExportPreference;
		quickCapturePreference: QuickCapturePreference;
		markdownExportEnabled: boolean;
		markdownExportReason: string | undefined;
		markdownExportSelectionRequired: boolean;
		markdownExportNotice: string;
		startupReady: boolean;
		opmlNotice: string;
		jsonBackupNotice: string;
		treeProjectionPreference: TreeProjection;
		navCollapsed: boolean;
		inspectorCollapsed: boolean;
		inspectorWidth: number;
		onPersistMarkdownExportPreference: () => void;
		onExportMarkdown: () => void | Promise<void>;
		onImportOpml: (file: File) => void | Promise<void>;
		onExportOpml: () => void | Promise<void>;
		onExportJsonBackup: () => void | Promise<void>;
		onRestoreJsonBackup: (file: File) => void | Promise<void>;
		onTreeProjectionChange: (projection: TreeProjection) => void;
		onNavigationCollapsedChange: (collapsed: boolean) => void;
		onInspectorCollapsedChange: (collapsed: boolean) => void;
		onInspectorWidthChange: (width: number) => void;
		onPersistQuickCapturePreference: () => void;
		onOpenLicenses: () => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
	let opmlFileInput = $state<HTMLInputElement>();
	let jsonBackupFileInput = $state<HTMLInputElement>();

	function importOpmlFile(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (file) void onImportOpml(file);
	}

	function restoreJsonBackupFile(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (file) void onRestoreJsonBackup(file);
	}

	function updateMarkdownExportScope(event: Event & { currentTarget: HTMLSelectElement }): void {
		markdownExportPreference = {
			...markdownExportPreference,
			scope: event.currentTarget.value === "selected" ? "selected" : "all",
		};
		onPersistMarkdownExportPreference();
	}

	function updateMarkdownExportReferenceMode(event: Event & { currentTarget: HTMLSelectElement }): void {
		const referenceMode = event.currentTarget.value;
		if (referenceMode !== "radiora" && referenceMode !== "portable" && referenceMode !== "obsidian") return;
		markdownExportPreference = { ...markdownExportPreference, referenceMode };
		onPersistMarkdownExportPreference();
	}

	function updateMarkdownExportIncludeAncestors(event: Event & { currentTarget: HTMLInputElement }): void {
		markdownExportPreference = { ...markdownExportPreference, includeAncestors: event.currentTarget.checked };
		onPersistMarkdownExportPreference();
	}

	function updateMarkdownExportIncludeDescendants(event: Event & { currentTarget: HTMLInputElement }): void {
		markdownExportPreference = { ...markdownExportPreference, includeDescendants: event.currentTarget.checked };
		onPersistMarkdownExportPreference();
	}

	function updateMarkdownExportIncludeSemanticNeighbors(event: Event & { currentTarget: HTMLInputElement }): void {
		markdownExportPreference = {
			...markdownExportPreference,
			includeSemanticNeighbors: event.currentTarget.checked,
		};
		onPersistMarkdownExportPreference();
	}

	function updateQuickCaptureDestination(event: Event & { currentTarget: HTMLSelectElement }): void {
		const destination = event.currentTarget.value === "unplaced" ? "unplaced" : "root";
		quickCapturePreference = { ...quickCapturePreference, destination };
		onPersistQuickCapturePreference();
	}
</script>

<section class="options-panel" aria-labelledby="options-title">
	<header class="options-heading">
		<p class="eyebrow">APPLICATION</p>
		<h1 id="options-title">Option</h1>
		<p>入力、書き出し、データ交換、バックアップ、表示方法を設定します。</p>
	</header>
	<div class="options-grid">
		<section class="option-card" aria-labelledby="option-export-title">
			<h2 id="option-export-title">書き出し</h2>
			<label>
				<span>{vocabulary.markdownExportScope}</span>
				<select value={markdownExportPreference.scope} onchange={updateMarkdownExportScope}>
					<option value="all">{vocabulary.markdownExportAll}</option>
					<option value="selected">{vocabulary.markdownExportSelected}</option>
				</select>
			</label>
			<label>
				<span>{vocabulary.markdownExportMode}</span>
				<select value={markdownExportPreference.referenceMode} onchange={updateMarkdownExportReferenceMode}>
					<option value="radiora">{vocabulary.markdownExportRadiora}</option>
					<option value="portable">{vocabulary.markdownExportPortable}</option>
					<option value="obsidian">{vocabulary.markdownExportObsidian}</option>
				</select>
			</label>
			<div class="option-checks">
				<label><input type="checkbox" checked={markdownExportPreference.includeAncestors} onchange={updateMarkdownExportIncludeAncestors} />{vocabulary.markdownExportAncestors}</label>
				<label><input type="checkbox" checked={markdownExportPreference.includeDescendants} onchange={updateMarkdownExportIncludeDescendants} />{vocabulary.markdownExportDescendants}</label>
				<label><input type="checkbox" checked={markdownExportPreference.includeSemanticNeighbors} onchange={updateMarkdownExportIncludeSemanticNeighbors} />{vocabulary.markdownExportSemanticNeighbors}</label>
			</div>
			<button onclick={onExportMarkdown} disabled={!markdownExportEnabled || markdownExportSelectionRequired} title={markdownExportSelectionRequired ? vocabulary.markdownExportSelectionRequired : markdownExportReason}>{vocabulary.markdownExportAction}</button>
			{#if markdownExportNotice}<small class="markdown-export-notice" role="status">{markdownExportNotice}</small>{/if}
		</section>

		<section class="option-card" aria-labelledby="option-exchange-title">
			<h2 id="option-exchange-title">データ交換</h2>
			<p>アウトラインの階層と本文をOPML形式で交換します。</p>
			<input class="sr-only" type="file" accept=".opml,.xml,text/x-opml,application/xml,text/xml" aria-label={vocabulary.opmlImport} bind:this={opmlFileInput} onchange={importOpmlFile} />
			<div class="option-actions">
				<button onclick={() => opmlFileInput?.click()} disabled={!startupReady}>{vocabulary.opmlImport}</button>
				<button onclick={onExportOpml} disabled={!startupReady}>{vocabulary.opmlExport}</button>
			</div>
			{#if opmlNotice}<small class="opml-notice" role="status">{opmlNotice}</small>{/if}
		</section>

		<section class="option-card option-card--danger" aria-labelledby="option-backup-title">
			<h2 id="option-backup-title">バックアップ</h2>
			<p>完全バックアップはRadioraの全状態を扱います。復元すると現在の状態が置き換わります。</p>
			<input class="sr-only" type="file" accept=".json,application/json" aria-label={vocabulary.jsonBackupRestore} bind:this={jsonBackupFileInput} onchange={restoreJsonBackupFile} />
			<div class="option-actions">
				<button onclick={onExportJsonBackup} disabled={!startupReady}>{vocabulary.jsonBackupExport}</button>
				<button class="delete" onclick={() => jsonBackupFileInput?.click()} disabled={!startupReady}>{vocabulary.jsonBackupRestore}</button>
			</div>
			{#if jsonBackupNotice}<small class="json-backup-notice" role="status">{jsonBackupNotice}</small>{/if}
		</section>

		<section class="option-card" aria-labelledby="option-display-title">
			<h2 id="option-display-title">表示</h2>
			<label>
				<span>ツリーの表示方式</span>
				<select value={treeProjectionPreference} onchange={(event) => onTreeProjectionChange(event.currentTarget.value as TreeProjection)}>
					<option value="chronology">Chronology</option>
					<option value="lineage">Lineage</option>
				</select>
			</label>
			<div class="option-checks">
				<label><input type="checkbox" checked={navCollapsed} onchange={(event) => onNavigationCollapsedChange(event.currentTarget.checked)} />ナビゲーションを折りたたむ</label>
				<label><input type="checkbox" checked={inspectorCollapsed} onchange={(event) => onInspectorCollapsedChange(event.currentTarget.checked)} />インスペクターを閉じる</label>
			</div>
			<label>
				<span>インスペクター幅: {inspectorWidth}px</span>
				<input type="range" min="240" max="560" step="8" value={inspectorWidth} oninput={(event) => onInspectorWidthChange(event.currentTarget.valueAsNumber)} />
			</label>
		</section>

		<section class="option-card" aria-labelledby="option-quick-capture-title">
			<h2 id="option-quick-capture-title">入力</h2>
			<p>上部の入力欄から新しく作る本文を、どこへ保存するか選びます。検索結果を開く動作には影響しません。</p>
			<label>
				<span>{vocabulary.quickCaptureDestination}</span>
				<select value={quickCapturePreference.destination} onchange={updateQuickCaptureDestination}>
					<option value="root">{vocabulary.quickCaptureDestinationRoot}</option>
					<option value="unplaced">{vocabulary.quickCaptureDestinationUnplaced}</option>
				</select>
			</label>
		</section>

		<section class="option-card" aria-labelledby="option-licenses-title">
			<h2 id="option-licenses-title">ライセンス</h2>
			<p>このアプリが利用しているサードパーティソフトウェアのライセンス情報を表示します。</p>
			<div class="option-actions">
				<button onclick={onOpenLicenses}>ライセンス情報を表示</button>
			</div>
		</section>
	</div>
</section>

<style>
	.options-panel {
		height: 100%;
		overflow: auto;
		padding: 32px clamp(24px, 5vw, 72px) 56px;
		background: var(--surface);
	}
	.options-heading {
		max-width: 760px;
		margin-bottom: 28px;
	}
	.options-heading h1 {
		margin: 4px 0 8px;
		font-size: 30px;
	}
	.options-heading p:last-child,
	.option-card > p {
		color: var(--muted);
	}
	.options-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(280px, 1fr));
		gap: 18px;
		max-width: 1080px;
	}
	.option-card {
		display: grid;
		align-content: start;
		gap: 14px;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-raised);
	}
	.option-card--danger {
		border-color: color-mix(in srgb, var(--danger, #b42318) 45%, var(--border));
	}
	.option-card h2,
	.option-card p {
		margin: 0;
	}
	.option-card label:not(.option-checks label) {
		display: grid;
		gap: 6px;
	}
	.option-card label > span {
		color: var(--muted);
		font-size: 11px;
	}
	.option-card select,
	.option-card input[type="range"] {
		width: 100%;
	}
	.option-checks {
		display: grid;
		gap: 9px;
	}
	.option-checks label {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.option-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	@media (max-width: 900px) {
		.options-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
