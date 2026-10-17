<script lang="ts">
	import { untrack } from "svelte";
	import type { UiVocabulary } from "../src/shared/ui_vocabulary.ts";
	import type { CommandPaletteItem } from "../src/ui/command_palette.ts";
	import CommandPaletteDialog from "../src/ui/CommandPaletteDialog.svelte";

	let {
		commands,
		vocabulary,
		initialQuery = "",
		onClose,
		onExecute,
	}: {
		commands: readonly CommandPaletteItem[];
		vocabulary: UiVocabulary;
		initialQuery?: string;
		onClose: () => void;
		onExecute: (command: CommandPaletteItem) => void;
	} = $props();

	let open = $state(true);
	let query = $state(untrack(() => initialQuery));

	function close(): void {
		onClose();
		open = false;
	}
</script>

<CommandPaletteDialog
	{open}
	{commands}
	{vocabulary}
	bind:query
	onClose={close}
	{onExecute}
/>
<output aria-label="Current query">{query}</output>
