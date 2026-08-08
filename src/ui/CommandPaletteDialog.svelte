<script lang="ts">
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import { nextCommandPaletteIndex, type CommandPaletteItem } from "./command_palette.ts";

	let {
		open,
		commands,
		vocabulary,
		query = $bindable(""),
		activeIndex = $bindable(-1),
		onClose,
		onExecute,
	}: {
		open: boolean;
		commands: readonly CommandPaletteItem[];
		vocabulary: UiVocabulary;
		query: string;
		activeIndex: number;
		onClose: () => void | Promise<void>;
		onExecute: (command: CommandPaletteItem) => void | Promise<void>;
	} = $props();

	let commandPaletteInput = $state<HTMLInputElement | null>(null);

	const activeCommand = $derived(
		activeIndex < 0 ? null : commands[activeIndex] ?? null,
	);

	$effect(() => {
		if (open) commandPaletteInput?.focus();
	});

	function handleBackdropClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		void onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			activeIndex = nextCommandPaletteIndex(
				activeIndex,
				event.key === "ArrowDown" ? 1 : -1,
				commands.length,
			);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			if (activeCommand) void onExecute(activeCommand);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			void onClose();
		}
	}
</script>

{#if open}
	<dialog
		open
		class="command-palette"
		aria-modal="true"
		aria-label={vocabulary.commandPalette}
		onclick={handleBackdropClick}
	>
		<div class="command-palette__content">
			<input
				bind:this={commandPaletteInput}
				bind:value={query}
				aria-label={`${vocabulary.commandPalette}を検索`}
				aria-controls="command-palette-results"
				aria-activedescendant={activeCommand
					? `command-palette-${activeCommand.id}`
					: undefined}
				placeholder={`${vocabulary.commandPalette}を検索…`}
				onkeydown={handleKeydown}
				autocomplete="off"
			/>
			<div id="command-palette-results" role="listbox" aria-label={vocabulary.commandPalette}>
				{#each commands as command, index (command.id)}
					<button
						id={`command-palette-${command.id}`}
						class:active={index === activeIndex}
						role="option"
						aria-selected={index === activeIndex}
						disabled={!command.availability.enabled}
						title={command.availability.reason}
						onclick={() => onExecute(command)}
					>
						<span>{command.label}</span>
						{#if command.shortcut}<small>{command.shortcut}</small>{/if}
					</button>
				{/each}
				{#if commands.length === 0}<p>一致するコマンドはありません。</p>{/if}
			</div>
			{#if activeCommand && !activeCommand.availability.enabled}
				<p class="command-palette__reason" aria-live="polite">
					{activeCommand.availability.reason}
				</p>
			{/if}
		</div>
	</dialog>
{/if}
