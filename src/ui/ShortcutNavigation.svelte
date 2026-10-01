<script lang="ts">
	import type { CommandPaletteItem } from "./command_palette.ts";
	import type { CommandId } from "./command_service.ts";
	let { commands, notice, onChoose, onCancel }: {
		commands: readonly (CommandPaletteItem & { chordKey: string })[];
		notice: string;
		onChoose: (id: CommandId) => void;
		onCancel: () => void;
	} = $props();
</script>

<section class="shortcut-navigation" aria-label="Radioraの二段ショートカット" data-shortcut-navigation>
	<div class="title"><strong>Radiora操作</strong><span>Ctrl+/ → 次のキー</span><button type="button" onclick={onCancel}>Esc 取消</button></div>
	<div class="commands">
		{#each commands as command (command.id)}
			<button type="button" aria-disabled={!command.availability.enabled} title={command.availability.reason}
				onclick={() => onChoose(command.id)}>
				<kbd>{command.chordKey}</kbd><span>{command.label}{#if !command.availability.enabled}<small>{command.availability.reason}</small>{/if}</span>
			</button>
		{/each}
	</div>
	<p role="status">{notice || "Ctrlを離して次のキーを押してください。クリックでも選べます。"}</p>
</section>

<style>
	.shortcut-navigation { position: fixed; z-index: 80; bottom: 20px; left: 50%; transform: translateX(-50%); width: min(640px, calc(100vw - 32px)); padding: 14px; border: 1px solid var(--border-bright); border-radius: 8px; background: var(--surface-raised); color: var(--text); box-shadow: 0 12px 32px #0008; }
	.title { display: flex; align-items: center; gap: 12px; }
	.title span, p, small { color: var(--muted); font-size: 11px; }
	.title button { margin-left: auto; }
	.commands { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
	button { display: flex; align-items: center; gap: 10px; padding: 8px; text-align: left; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; }
	button[aria-disabled="true"] { opacity: .55; }
	button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
	kbd { color: var(--cyan); }
	small { display: block; }
	p { margin: 10px 0 0; }
</style>
