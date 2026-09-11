<script lang="ts">
	import type { HistoricalDateDraft } from "./historical_time_form.ts";
	let { value, label, allowUnknown = false }: { value: HistoricalDateDraft; label: string; allowUnknown?: boolean } = $props();
</script>

<fieldset>
	<legend>{label}</legend>
	{#if allowUnknown}<label><input type="checkbox" bind:checked={value.unknown} />不明</label>{/if}
	{#if !allowUnknown || !value.unknown}
		<div class="fields">
			<label>精度<select bind:value={value.precision}><option value="century">世紀</option><option value="year">年</option><option value="month">月</option><option value="day">日</option></select></label>
			<label>紀元<select bind:value={value.era}><option value="ce">西暦</option><option value="bce">紀元前</option></select></label>
			{#if value.precision === "century"}
				<label>世紀<input inputmode="numeric" bind:value={value.century} /></label>
			{:else}
				<label>年<input inputmode="numeric" bind:value={value.year} /></label>
			{/if}
			{#if value.precision === "month" || value.precision === "day"}<label>月<input inputmode="numeric" bind:value={value.month} /></label>{/if}
			{#if value.precision === "day"}<label>日<input inputmode="numeric" bind:value={value.day} /></label>{/if}
		</div>
		<label><input type="checkbox" bind:checked={value.approximate} />頃</label>
	{/if}
</fieldset>

<style>
	fieldset { min-width: 0; border: 1px solid var(--border); border-radius: 5px; padding: 8px; }
	.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
	.fields label { display: grid; gap: 3px; }
	input:not([type="checkbox"]), select { width: 100%; min-width: 0; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 5px; }
</style>
