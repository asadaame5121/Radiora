<script lang="ts">
	import { Dialog } from "bits-ui";
	import type { HistoricalTimeController } from "./historical_time_controller.svelte.ts";
	let { controller }: { controller: HistoricalTimeController } = $props();
</script>

<Dialog.Root open={controller.pending !== null} onOpenChange={(open) => { if (!open) void controller.resolvePending("cancel"); }}>
	<Dialog.Portal>
		<Dialog.Overlay>{#snippet child({ props })}<div {...props} class="overlay"></div>{/snippet}</Dialog.Overlay>
		<Dialog.Content>{#snippet child({ props })}
			<div {...props} class="dialog">
				<Dialog.Title>年代の変更を保存しますか？</Dialog.Title>
				<Dialog.Description>別のノートへ移る前に、未保存の年代の扱いを選んでください。</Dialog.Description>
				{#if controller.error}<p role="alert">{controller.error}</p>{/if}
				<div class="actions">
					<button type="button" disabled={controller.submitting} onclick={() => void controller.resolvePending("save")}>保存して移動</button>
					<button type="button" disabled={controller.submitting} onclick={() => void controller.resolvePending("discard")}>破棄して移動</button>
					<button type="button" disabled={controller.submitting} onclick={() => void controller.resolvePending("cancel")}>キャンセル</button>
				</div>
			</div>
		{/snippet}</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.overlay { position: fixed; inset: 0; z-index: 1000; background: rgb(0 0 0 / 55%); }
	.dialog { position: fixed; z-index: 1001; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(460px, 90vw); padding: 24px; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 8px; }
	.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
	button { padding: 8px; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 4px; }
	[role="alert"] { color: var(--red); }
</style>
