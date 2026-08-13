<script lang="ts">
	import type {
		RelationTypeDefinition,
		RelationTypeDirection,
	} from "../domain/models.ts";
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
		relationTypeDefinitions,
		onCreateRelationTypeDefinition,
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
		relationTypeDefinitions: readonly RelationTypeDefinition[];
		onCreateRelationTypeDefinition: (input: {
			name: string;
			direction: RelationTypeDirection;
		}) => Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
	let opmlFileInput = $state<HTMLInputElement>();
	let jsonBackupFileInput = $state<HTMLInputElement>();
	let relationTypeName = $state("");
	let relationTypeDirection = $state<RelationTypeDirection>("directed");
	let relationTypeSubmitting = $state(false);
	let relationTypeNotice = $state("");
	let relationTypeError = $state("");

	async function createRelationType(): Promise<void> {
		if (relationTypeSubmitting) return;
		try {
			relationTypeSubmitting = true;
			relationTypeError = "";
			relationTypeNotice = "";
			await onCreateRelationTypeDefinition({
				name: relationTypeName,
				direction: relationTypeDirection,
			});
			relationTypeName = "";
			relationTypeDirection = "directed";
			relationTypeNotice = "意味関係を追加しました。";
		} catch (cause) {
			relationTypeError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			relationTypeSubmitting = false;
		}
	}

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
</script>

<section class="options-panel" aria-labelledby="options-title">
	<header class="options-heading">
		<p class="eyebrow">APPLICATION</p>
		<h1 id="options-title">Option</h1>
		<p>入力、書き出し、データ交換、バックアップ、表示方法を設定します。</p>
	</header>
	<div class="options-grid">
		<section class="option-card relation-type-card" aria-labelledby="option-relation-types-title">
			<h2 id="option-relation-types-title">意味関係</h2>
			<p>リンクに使う関係名と、関係の向きを追加します。既存の定義は変更されません。</p>
			<ul class="relation-type-list" aria-label="意味関係の定義一覧">
				{#each relationTypeDefinitions as definition (definition.name)}
					<li>
						<strong>{definition.name}</strong>
						<span>{definition.direction === "symmetric" ? "無向（双方向）" : "有向"}</span>
						{#if definition.builtIn}<small>既定</small>{:else}<small>ユーザー定義</small>{/if}
					</li>
				{/each}
			</ul>
			<form onsubmit={(event) => { event.preventDefault(); void createRelationType(); }}>
				<label>
					<span>名前</span>
					<input
						bind:value={relationTypeName}
						disabled={!startupReady || relationTypeSubmitting}
						placeholder="例: CAUSES"
						maxlength="64"
						autocomplete="off"
					/>
				</label>
				<fieldset disabled={!startupReady || relationTypeSubmitting}>
					<legend>方向</legend>
					<label><input type="radio" bind:group={relationTypeDirection} value="directed" />有向</label>
					<label><input type="radio" bind:group={relationTypeDirection} value="symmetric" />無向（双方向）</label>
				</fieldset>
				<button disabled={!startupReady || relationTypeSubmitting || !relationTypeName.trim()}>
					{relationTypeSubmitting ? "追加中…" : "意味関係を追加"}
				</button>
			</form>
			<small class="relation-type-help">英字で始まる半角英大文字・数字・_（最大64文字）。小文字は大文字として保存されます。</small>
			{#if relationTypeNotice}<small role="status">{relationTypeNotice}</small>{/if}
			{#if relationTypeError}<small class="relation-type-error" role="alert">{relationTypeError}</small>{/if}
		</section>
		<section class="option-card" aria-labelledby="option-export-title">
			<h2 id="option-export-title">書き出し</h2>
			<label>
				<span>{vocabulary.markdownExportScope}</span>
				<select bind:value={markdownExportPreference.scope} onchange={onPersistMarkdownExportPreference}>
					<option value="all">{vocabulary.markdownExportAll}</option>
					<option value="selected">{vocabulary.markdownExportSelected}</option>
				</select>
			</label>
			<label>
				<span>{vocabulary.markdownExportMode}</span>
				<select bind:value={markdownExportPreference.referenceMode} onchange={onPersistMarkdownExportPreference}>
					<option value="radiora">{vocabulary.markdownExportRadiora}</option>
					<option value="portable">{vocabulary.markdownExportPortable}</option>
					<option value="obsidian">{vocabulary.markdownExportObsidian}</option>
				</select>
			</label>
			<div class="option-checks">
				<label><input type="checkbox" bind:checked={markdownExportPreference.includeAncestors} onchange={onPersistMarkdownExportPreference} />{vocabulary.markdownExportAncestors}</label>
				<label><input type="checkbox" bind:checked={markdownExportPreference.includeDescendants} onchange={onPersistMarkdownExportPreference} />{vocabulary.markdownExportDescendants}</label>
				<label><input type="checkbox" bind:checked={markdownExportPreference.includeSemanticNeighbors} onchange={onPersistMarkdownExportPreference} />{vocabulary.markdownExportSemanticNeighbors}</label>
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
				<select bind:value={quickCapturePreference.destination} onchange={onPersistQuickCapturePreference}>
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
	.relation-type-list {
		display: grid;
		gap: 6px;
		max-height: 220px;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}
	.relation-type-list li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		border: 1px solid #17313e;
		border-radius: 5px;
		background: #07121a;
	}
	.relation-type-list strong { overflow-wrap: anywhere; }
	.relation-type-list span,
	.relation-type-list small,
	.relation-type-help { color: #7f949e; }
	.relation-type-card form { display: grid; gap: 10px; }
	.relation-type-card fieldset {
		display: flex;
		gap: 16px;
		margin: 0;
		padding: 8px 0;
		border: 0;
	}
	.relation-type-card fieldset label { display: flex; align-items: center; gap: 6px; }
	.relation-type-error { color: #ef8f8f; }
</style>
