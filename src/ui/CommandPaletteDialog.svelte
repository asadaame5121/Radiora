<script lang="ts">
	import { Command, Dialog } from "bits-ui";
	import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
	import type { CommandPaletteItem } from "./command_palette.ts";

	let {
		open,
		commands,
		vocabulary,
		query = $bindable(""),
		onClose,
		onExecute,
	}: {
		open: boolean;
		commands: readonly CommandPaletteItem[];
		vocabulary: UiVocabulary;
		query: string;
		onClose: () => void | Promise<void>;
		onExecute: (command: CommandPaletteItem) => void | Promise<void>;
	} = $props();

	let commandPaletteInput = $state<HTMLInputElement | null>(null);

	function handleOpenChange(nextOpen: boolean): void {
		if (!nextOpen) void onClose();
	}

	function handleOpenAutoFocus(event: Event): void {
		event.preventDefault();
		commandPaletteInput?.focus();
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="command-palette"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content onOpenAutoFocus={handleOpenAutoFocus}>
			{#snippet child({ props: contentProps })}
				<div
					{...contentProps}
					class="command-palette__content"
					role="dialog"
					aria-label={vocabulary.commandPalette}
				>
					<Command.Root
						shouldFilter={false}
						loop={true}
						vimBindings={false}
						label={vocabulary.commandPalette}
					>
						{#snippet child({ props: commandProps })}
							<div {...commandProps} class="command-palette__command">
							<Command.Input bind:value={query}>
									{#snippet child({ props: inputProps })}
										<input
											{...inputProps}
											bind:this={commandPaletteInput}
											class="command-palette__input"
											aria-label={`${vocabulary.commandPalette}を検索`}
											aria-controls="command-palette-results"
											placeholder={`${vocabulary.commandPalette}を検索…`}
										/>
									{/snippet}
								</Command.Input>
								<Command.List id="command-palette-results" aria-label={vocabulary.commandPalette}>
									{#snippet child({ props: listProps })}
										<div {...listProps} class="command-palette__list">
											{#each commands as command (command.id)}
												<Command.Item
													value={command.id}
													disabled={!command.availability.enabled}
													onSelect={() => void onExecute(command)}
												>
													{#snippet child({ props: itemProps })}
														<button
															{...itemProps}
															type="button"
															disabled={!command.availability.enabled}
															title={command.availability.reason}
															class="command-palette__item"
														>
															<span>{command.label}</span>
															{#if command.shortcut}<small>{command.shortcut}</small>{/if}
														</button>
													{/snippet}
												</Command.Item>
											{/each}
										</div>
									{/snippet}
								</Command.List>
								<Command.Empty>
									{#snippet child({ props: emptyProps })}
										<div {...emptyProps} class="command-palette__empty" role="status">
											<p>一致するコマンドはありません。</p>
										</div>
									{/snippet}
								</Command.Empty>
							</div>
						{/snippet}
					</Command.Root>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.command-palette {
		position: fixed;
		inset: 0;
		box-sizing: border-box;
		width: 100vw;
		height: 100vh;
		max-width: none;
		max-height: none;
		margin: 0;
		border: 0;
		z-index: 100;
		display: grid;
		place-items: start center;
		padding-top: min(18vh, 160px);
		background: rgb(0 0 0 / 52%);
	}

	.command-palette__content {
		width: min(560px, calc(100vw - 32px));
		overflow: hidden;
		background: var(--surface-raised);
		border: 1px solid var(--border-bright);
		border-radius: 10px;
		box-shadow: 0 20px 60px #000c;
		position: fixed;
		top: min(18vh, 160px);
		left: 50%;
		z-index: 101;
		transform: translateX(-50%);
	}

	.command-palette__input {
		box-sizing: border-box;
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--border);
		background: #04080d;
		color: var(--text);
		padding: 14px;
		outline: none;
	}

	.command-palette__list {
		max-height: min(50vh, 400px);
		overflow: auto;
	}

	.command-palette__item {
		display: flex;
		justify-content: space-between;
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--border);
		padding: 11px 14px;
		text-align: left;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}

	.command-palette__item[data-selected],
	.command-palette__item:hover {
		background: var(--surface-hover);
	}

	.command-palette__item:disabled {
		color: var(--muted);
		cursor: not-allowed;
	}

	.command-palette__empty {
		margin: 0;
		padding: 10px 14px;
		color: var(--muted);
	}

	.command-palette__empty p {
		margin: 0;
	}
</style>
