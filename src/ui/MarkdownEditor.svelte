<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import type { MarkdownEditorAdapter, MarkdownEditorMode } from "./markdown_editor_adapter";
	import { createMarkdownEditorAdapter } from "./overtype_markdown_editor_adapter";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		value,
		itemId,
		onChange,
		onKeydown,
		onSelectionChange,
		onFocus,
		onInternalReference,
	}: {
		value: string;
		itemId: string;
		onChange: (value: string, textarea: HTMLTextAreaElement) => void;
		onKeydown: (
			event: KeyboardEvent,
			textarea: HTMLTextAreaElement,
			compositionGuard: boolean,
		) => void;
		onSelectionChange?: (textarea: HTMLTextAreaElement) => void;
		onFocus?: (textarea: HTMLTextAreaElement) => void;
		onInternalReference: (destination: string) => void;
	} = $props();

	let host: HTMLDivElement;
	let adapter = $state<MarkdownEditorAdapter | null>(null);
	let mode = $state<MarkdownEditorMode>("preview");
	let fallback = $state(false);
	const vocabulary = useUiVocabulary();

	onMount(() => {
		adapter = createMarkdownEditorAdapter({
			host,
			value,
			textareaAttributes: {
				"data-item-id": itemId,
				rows: "1",
				"aria-label": vocabulary.markdownEditor,
			},
			onChange,
			onKeydown,
			onSelectionChange,
			onFocus: handleFocus,
			onBlur: handleBlur,
			onInternalReference,
			onFallback: () => fallback = true,
		});
		adapter.setMode(mode);
		const onHostClick = (event: MouseEvent) => focusEditor(event);
		const onFocusRequest = (event: Event) => {
			const current = adapter;
			if (!current) return;
			const requestedOffset = (event as CustomEvent<{ caretOffset?: number }>).detail
				?.caretOffset;
			changeMode("plain");
			current.focus();
			const caret = Math.max(
				0,
				Math.min(requestedOffset ?? current.getValue().length, current.getValue().length),
			);
			current.setSelection({ start: caret, end: caret, direction: "none" });
			current.textarea.scrollIntoView({ block: "center" });
		};
		host.addEventListener("click", onHostClick);
		host.addEventListener("radiora:focus-editor", onFocusRequest);
		return () => {
			host.removeEventListener("click", onHostClick);
			host.removeEventListener("radiora:focus-editor", onFocusRequest);
		};
	});

	$effect(() => {
		const current = adapter;
		const next = value;
		if (current && current.getValue() !== next) current.setValue(next);
	});

	function changeMode(next: MarkdownEditorMode): void {
		if (mode === next) return;
		mode = next;
		adapter?.setMode(next);
	}

	function handleFocus(textarea: HTMLTextAreaElement): void {
		changeMode("plain");
		onFocus?.(textarea);
	}

	function handleBlur(_textarea: HTMLTextAreaElement): void {
		changeMode("preview");
	}

	function focusEditor(event: MouseEvent): void {
		const target = event.target;
		if (target instanceof Element && target.closest("a, button, select, option")) return;
		changeMode("plain");
		adapter?.focus();
	}

	onDestroy(() => {
		adapter?.destroy();
		adapter = null;
	});
</script>

<div class="markdown-editor" class:fallback>
	<div class="markdown-editor-host" data-editor-item-id={itemId} bind:this={host}></div>
	<label class="markdown-editor-mode">
		<span>{vocabulary.editorMode}</span>
		<select value={mode} onchange={(event) => changeMode(event.currentTarget.value as MarkdownEditorMode)}>
			<option value="normal">{vocabulary.editorNormal}</option>
			<option value="plain">{vocabulary.editorPlain}</option>
			<option value="preview">{vocabulary.editorPreview}</option>
		</select>
	</label>
</div>

<style>
	.markdown-editor {
		position: relative;
		min-width: 0;
	}
	.markdown-editor-host {
		position: relative;
		height: 34px;
		min-height: 34px;
		max-height: 140px;
		overflow: hidden;
		border-radius: 5px;
	}
	:global(.row.selected) .markdown-editor-host,
	:global(.row:focus-within) .markdown-editor-host {
		height: 96px;
	}
	:global(.row.has-body:not(.selected):not(:focus-within)) .markdown-editor-host {
		height: 44px;
		min-height: 44px;
	}
	.markdown-editor-host :global(.overtype-container),
	.markdown-editor-host :global(.overtype-wrapper) {
		height: 100% !important;
		min-height: 0 !important;
		max-height: 100% !important;
		overflow: hidden !important;
	}
	.markdown-editor-host :global(.overtype-container) {
		--preview-text-default: var(--text);
		--preview-bg-default: transparent;
		--preview-h1-default: var(--text);
		--preview-h2-default: var(--text);
		--preview-h3-default: var(--text);
		--preview-strong-default: var(--amber);
		--preview-em-default: var(--cyan-soft);
		--preview-link-default: var(--cyan-soft);
		--preview-code-default: var(--text);
		--preview-code-bg-default: var(--surface-raised);
		--preview-blockquote-default: var(--cyan-soft);
		--preview-hr-default: var(--border-bright);
	}
	.markdown-editor-host :global(:is(.overtype-container, .overtype-wrapper, .overtype-input, .overtype-preview)) {
		background: transparent !important;
		color: var(--text);
	}
	.markdown-editor-host :global(:is(.overtype-input, .overtype-preview)) {
		max-height: 100% !important;
		overflow: auto !important;
	}
	:global(.row.has-body:not(.selected):not(:focus-within)) .markdown-editor-host :global(:is(.overtype-input, .overtype-preview)) {
		padding: 2px 8px !important;
		overflow: hidden !important;
	}
	:global(.row:not(.selected):not(:focus-within)) .markdown-editor-host :global(:is(.overtype-input, .overtype-preview)) {
		overflow: hidden !important;
	}
	:global(.row:not(.selected):not(:focus-within)) .markdown-editor-host :global(.overtype-preview) {
		color: #9aabb2 !important;
	}
	:global(.row.has-body:not(.selected):not(:focus-within)) .markdown-editor-host :global(.overtype-preview > div) {
		overflow: hidden !important;
		text-overflow: ellipsis;
		white-space: nowrap !important;
	}
	:global(.row.has-body:not(.selected):not(:focus-within)) .markdown-editor-host :global(.overtype-preview > div:first-child) {
		color: var(--text) !important;
	}
	:global(.row.has-body:not(.selected):not(:focus-within)) .markdown-editor-host :global(.overtype-preview > div:nth-child(n + 2)) {
		color: #718894 !important;
	}
	:global(.row.has-body:not(.selected):not(:focus-within)) .markdown-editor-host :global(.overtype-preview > div:nth-child(n + 3)) {
		display: none !important;
	}
	.markdown-editor.fallback .markdown-editor-host :global(textarea) {
		width: 100%;
		height: 100%;
		resize: vertical;
	}
	.markdown-editor-mode {
		position: absolute;
		z-index: 5;
		bottom: 0;
		right: 6px;
		display: none;
		align-items: center;
		gap: 4px;
		height: 18px;
	}
	:global(.row.selected) .markdown-editor-mode,
	.markdown-editor-mode:focus-within {
		display: flex;
		opacity: 1;
	}
	:global(.row.selected) .markdown-editor,
	:global(.row:focus-within) .markdown-editor {
		padding-bottom: 22px;
	}
	.markdown-editor-mode span {
		color: var(--muted);
		font-size: 9px;
	}
	.markdown-editor-mode select {
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 2px 4px;
		color: var(--muted);
		background: var(--surface-raised);
		font-size: 9px;
	}
</style>
