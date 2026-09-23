<script lang="ts">
	import { onMount } from "svelte";
	import type { RadioraBindings } from "../shared/bindings.ts";
	import type { OperationSummary } from "../shared/operation_log_types.ts";
	import { downloadTextFile } from "./download_text_file.ts";

	type OperationLogPort = Pick<RadioraBindings, "getOperationSummary" | "exportOperationLog" | "clearDiagnosticLogs">;
	let { startupReady, operationLogPort }: { startupReady: boolean; operationLogPort: OperationLogPort } = $props();
	let summary = $state<OperationSummary | null>(null);
	let notice = $state("");
	let busy = $state(false);
	const PERCENT = 100;

	async function refresh(): Promise<void> {
		try {
			summary = await operationLogPort.getOperationSummary();
		} catch {
			notice = "記録を読み込めませんでした。";
		}
	}

	onMount(() => { if (startupReady) void refresh(); });

	async function download(): Promise<void> {
		busy = true;
		try {
			const jsonl = await operationLogPort.exportOperationLog();
			downloadTextFile(jsonl, "application/x-ndjson;charset=utf-8", `radiora-operations-${new Date().toISOString().slice(0, 10)}.jsonl`);
			notice = "OperationLogを書き出しました。";
		} catch {
			notice = "OperationLogを書き出せませんでした。";
		} finally {
			busy = false;
		}
	}

	async function clear(): Promise<void> {
		if (!window.confirm("OperationLogと診断ログをすべて削除しますか？")) return;
		busy = true;
		try {
			await operationLogPort.clearDiagnosticLogs();
			await refresh();
			notice = "診断ログをすべて削除しました。";
		} catch {
			notice = "診断ログを削除できませんでした。";
		} finally {
			busy = false;
		}
	}
</script>

<section class="operation-log" aria-labelledby="operation-log-title">
	<h2 id="operation-log-title">操作記録</h2>
	<p>操作と画面遷移を端末内に最大30日間・20 MB保存します。本文・検索語・項目名は記録しません。自動送信は行いません。</p>
	{#if summary}
		<p>{summary.count}件 · {summary.bytes.toLocaleString()} bytes · 失敗率 {summary.count ? Math.round(summary.failed / summary.count * PERCENT) : 0}% · 平均 {summary.averageDurationMs} ms</p>
		<div class="columns">
			<div><h3>日別</h3><ul>{#each summary.byDay as row}<li>{row.day}: {row.count}件</li>{/each}</ul></div>
			<div><h3>操作別</h3><ul>{#each summary.byEvent as row}<li>{row.event}: {row.count}件</li>{/each}</ul></div>
		</div>
		<details><summary>直近の記録</summary><ul>{#each summary.recent as row}<li>{row.timestamp} · {row.event} · {row.outcome} · {row.durationMs} ms</li>{/each}</ul></details>
	{/if}
	<div class="actions">
		<button type="button" onclick={() => void refresh()} disabled={!startupReady || busy}>更新</button>
		<button type="button" onclick={() => void download()} disabled={!startupReady || busy}>JSONLを書き出す</button>
		<button type="button" class="delete" onclick={() => void clear()} disabled={!startupReady || busy}>診断ログをすべて削除</button>
	</div>
	{#if notice}<small role="status">{notice}</small>{/if}
</section>

<style>
	.operation-log { display: grid; align-content: start; gap: 14px; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-raised); grid-column: 1 / -1; }
	h2, h3, p, ul { margin: 0; }
	p { color: var(--muted); }
	.columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
	ul { padding-left: 20px; max-height: 200px; overflow: auto; }
	li { overflow-wrap: anywhere; }
	.actions { display: flex; flex-wrap: wrap; gap: 8px; }
	@media (max-width: 600px) { .columns { grid-template-columns: 1fr; } }
</style>
