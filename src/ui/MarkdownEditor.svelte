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
	let mode = $state<MarkdownEditorMode>("normal");
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
			onFocus,
			onInternalReference,
			onFallback: () => fallback = true,
		});
		adapter.setMode(mode);
	});

	$effect(() => {
		const current = adapter;
		const next = value;
		if (current && current.getValue() !== next) current.setValue(next);
	});

	function changeMode(next: MarkdownEditorMode): void {
		mode = next;
		adapter?.setMode(next);
	}

	onDestroy(() => {
		adapter?.destroy();
		adapter = null;
	});
</script>

<div class="markdown-editor" class:fallback>
	<div class="markdown-editor-host" bind:this={host}></div>
	<label class="markdown-editor-mode">
		<span>{vocabulary.editorMode}</span>
		<select value={mode} onchange={(event) => changeMode(event.currentTarget.value as MarkdownEditorMode)}>
			<option value="normal">{vocabulary.editorNormal}</option>
			<option value="plain">{vocabulary.editorPlain}</option>
			<option value="preview">{vocabulary.editorPreview}</option>
		</select>
	</label>
</div>
