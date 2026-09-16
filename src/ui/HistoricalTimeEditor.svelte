<script lang="ts">
	import HistoricalDateFields from "./HistoricalDateFields.svelte";
	import type { HistoricalTimeController } from "./historical_time_controller.svelte.ts";
	let { controller }: { controller: HistoricalTimeController } = $props();
</script>

<section aria-label="年代">
	<h3>年代 <small>同じノートの全配置で共有</small></h3>
	<form onsubmit={(event) => { event.preventDefault(); void controller.save(); }}>
		<fieldset disabled={controller.submitting}>
			<label>種類<select bind:value={controller.draft.kind}><option value="point">時点</option><option value="period">期間</option></select></label>
			<HistoricalDateFields value={controller.draft.start} label={controller.draft.kind === "point" ? "時点" : "開始"} allowUnknown={controller.draft.kind === "period"} />
			{#if controller.draft.kind === "period"}<HistoricalDateFields value={controller.draft.end} label="終了" allowUnknown />{/if}
			<label>原表記（任意）<input bind:value={controller.draft.original} placeholder="史料の表記など" /></label>
			<p>先発グレゴリオ暦の年月日を入力してください。原表記の暦は自動変換しません。</p>
			<div class="actions"><button type="submit">保存</button><button type="button" onclick={() => controller.reset()}>取消</button><button type="button" disabled={!controller.item?.historicalTime} onclick={() => void controller.save(true)}>削除</button></div>
		</fieldset>
	</form>
	{#if controller.error}<p role="alert">{controller.error}</p>{/if}
	{#if controller.dirty}<p role="status">未保存の変更があります</p>{/if}
</section>

<style>
	section { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 12px; font-size: 11px; }
	h3 { font-size: 12px; } small, p { color: var(--muted); font-weight: normal; }
	fieldset { display: grid; gap: 8px; padding: 0; margin: 0; border: 0; min-width: 0; }
	label { display: grid; gap: 4px; }
	input, select, button { min-width: 0; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 6px; }
	.actions { display: flex; gap: 6px; } [role="alert"] { color: var(--red); }
</style>
