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
		readOnly = false,
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
		readOnly?: boolean;
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
		adapter.setReadOnly(readOnly);
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

	$effect(() => {
		adapter?.setReadOnly(readOnly);
	});

	function changeMode(next: MarkdownEditorMode): void {
		if (readOnly) return;
		if (mode === next) return;
		mode = next;
		adapter?.setMode(next);
	}

	function handleFocus(textarea: HTMLTextAreaElement): void {
		if (!readOnly) changeMode("plain");
		onFocus?.(textarea);
	}

	function handleBlur(_textarea: HTMLTextAreaElement): void {
		changeMode("preview");
	}

	function focusEditor(event: MouseEvent): void {
		const target = event.target;
		if (target instanceof Element && target.closest("a, button, select, option")) return;
		if (readOnly) return;
		changeMode("plain");
		adapter?.focus();
	}

	onDestroy(() => {
		adapter?.destroy();
		adapter = null;
	});
</script>

<div class="markdown-editor" class:fallback class:read-only={readOnly}>
	<div class="markdown-editor-host" data-editor-item-id={itemId} bind:this={host}></div>
	{#if readOnly}
		<span class="markdown-editor-read-only">固定版・読み取り専用</span>
	{:else}
		<label class="markdown-editor-mode">
			<span>{vocabulary.editorMode}</span>
			<select value={mode} onchange={(event) => changeMode(event.currentTarget.value as MarkdownEditorMode)}>
				<option value="normal">{vocabulary.editorNormal}</option>
				<option value="plain">{vocabulary.editorPlain}</option>
				<option value="preview">{vocabulary.editorPreview}</option>
			</select>
		</label>
	{/if}
</div>

<style>
	.markdown-editor-read-only {
		position: absolute;
		z-index: 5;
		top: 3px;
		right: 8px;
		padding: 1px 5px;
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--muted);
		background: var(--surface-raised);
		font-size: 9px;
		pointer-events: none;
	}
</style>
