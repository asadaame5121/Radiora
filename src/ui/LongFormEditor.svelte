<script lang="ts">
	import type { OutlineItem } from "../domain/models.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		item,
		selectedBreadcrumb,
		preview,
		text,
		dirty,
		titleFor,
		onInput,
		onSave,
		onCancel,
		onSetPreview,
	}: {
		item: OutlineItem;
		selectedBreadcrumb: readonly OutlineItem[];
		preview: boolean;
		text: string;
		dirty: boolean;
		titleFor: (item: OutlineItem) => string;
		onInput: (value: string) => void;
		onSave: () => void;
		onCancel: () => void;
		onSetPreview: (preview: boolean) => void;
	} = $props();

	const vocabulary = useUiVocabulary();
</script>

<div class="section-title"><span>Outline · {vocabulary.manuscript}</span></div>
<div class="long-form-editor">
	<div class="long-form-breadcrumb">
		{#each selectedBreadcrumb as ancestor (ancestor.id)}
			<span>{titleFor(ancestor)} › </span>
		{/each}
		<span class="long-form-title">{titleFor(item)}</span>
	</div>
	<div class="long-form-toolbar">
		<button
			type="button"
			class:active={!preview}
			onclick={() => onSetPreview(false)}
		>編集</button>
		<button
			type="button"
			class:active={preview}
			onclick={() => onSetPreview(true)}
		>プレビュー</button>
	</div>
	{#if preview}
		<div class="long-form-preview">{text}</div>
	{:else}
		<textarea
			class="long-form-textarea"
			value={text}
			oninput={(event) => onInput(event.currentTarget.value)}
		></textarea>
	{/if}
	<div class="long-form-actions">
		<button
			type="button"
			onclick={onSave}
			disabled={!dirty}
		>保存</button>
		<button type="button" onclick={onCancel}>キャンセル</button>
	</div>
</div>

<style>
	.long-form-editor {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 0 8px;
		margin-top: 12px;
		min-height: 0;
	}
	.long-form-breadcrumb {
		color: var(--muted);
		font-size: 11px;
		padding: 0 4px;
	}
	.long-form-title {
		color: var(--text);
		font-weight: 600;
	}
	.long-form-toolbar {
		display: flex;
		gap: 4px;
		padding: 0 4px;
	}
	.long-form-toolbar button {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 4px 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.long-form-toolbar button.active {
		border-color: var(--cyan);
		color: var(--cyan);
	}
	.long-form-textarea {
		flex: 1;
		min-height: 50vh;
		resize: vertical;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-family: var(--font-serif);
		font-size: 14px;
		line-height: 1.75;
		padding: 16px;
		tab-size: 4;
	}
	.long-form-textarea:focus {
		border-color: var(--cyan);
		outline: none;
	}
	.long-form-preview {
		flex: 1;
		min-height: 50vh;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: #afc1c9;
		font-family: var(--font-serif);
		font-size: 14px;
		line-height: 1.75;
		padding: 16px;
		white-space: pre-wrap;
	}
	.long-form-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		padding: 4px;
	}
	.long-form-actions button {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		padding: 6px 16px;
		font-size: 13px;
		cursor: pointer;
	}
	.long-form-actions button:disabled {
		opacity: .4;
		cursor: default;
	}
</style>
