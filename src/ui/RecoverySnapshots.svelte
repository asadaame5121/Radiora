<script lang="ts">
	import type { RecoverySnapshot } from "../domain/models";
	import type { RecoverySnapshotPreview } from "../services/recovery_snapshot_service";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		snapshots,
		loadPreview,
		onRestore,
		onPromote,
	}: {
		snapshots: RecoverySnapshot[];
		loadPreview: (snapshotId: string) => Promise<RecoverySnapshotPreview>;
		onRestore: (snapshotId: string) => Promise<void>;
		onPromote: (snapshotId: string) => Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
	let selectedSnapshotId = $state("");
	let preview = $state<RecoverySnapshotPreview | null>(null);
	let loading = $state(false);
	let submitting = $state(false);
	let error = $state("");
	let previewRequest = 0;

	async function selectSnapshot(snapshotId: string): Promise<void> {
		const request = ++previewRequest;
		selectedSnapshotId = snapshotId;
		preview = null;
		error = "";
		if (!snapshotId) return;
		loading = true;
		try {
			const next = await loadPreview(snapshotId);
			if (request === previewRequest) preview = next;
		} catch (cause) {
			if (request === previewRequest) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (request === previewRequest) loading = false;
		}
	}

	async function restore(): Promise<void> {
		if (
			!selectedSnapshotId ||
			!confirm(
				`現在の${vocabulary.workingCopy}を${vocabulary.recoverySnapshot}として保存してから、この状態を復元します。続けますか？`,
			)
		) return;
		submitting = true;
		try {
			await onRestore(selectedSnapshotId);
			await selectSnapshot(selectedSnapshotId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			submitting = false;
		}
	}

	async function promote(): Promise<void> {
		if (
			!selectedSnapshotId ||
			!confirm(`この${vocabulary.recoverySnapshot}を変更不能な${vocabulary.revision}として保存しますか？`)
		) return;
		submitting = true;
		try {
			await onPromote(selectedSnapshotId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			submitting = false;
		}
	}
</script>

<section class="recovery-snapshots" aria-label={vocabulary.recoverySnapshot}>
	<header>
		<h2>{vocabulary.recoverySnapshot}</h2>
		<small>{snapshots.length}件</small>
	</header>
	{#if snapshots.length === 0}
		<p class="comparison-empty">{vocabulary.recoverySnapshot}はありません。</p>
	{:else}
		<label>
			状態
			<select
				value={selectedSnapshotId}
				onchange={(event) => void selectSnapshot(event.currentTarget.value)}
			>
				<option value="">選択してください</option>
				{#each snapshots as snapshot (snapshot.id)}
					<option value={snapshot.id}>
						{new Date(snapshot.createdAt).toLocaleString("ja-JP")}
						{snapshot.name ? ` · ${snapshot.name}` : ""}
					</option>
				{/each}
			</select>
		</label>
		{#if loading}
			<p class="comparison-empty">差分を読み込んでいます…</p>
		{:else if preview}
			<div class="snapshot-actions">
				<button disabled={submitting} onclick={restore}>この状態を復元</button>
				<button disabled={submitting} onclick={promote}>この状態を稿として保存</button>
			</div>
			<div class="snapshot-diff" aria-label={`${vocabulary.workingCopy}との差分`}>
				{#each preview.diff as node}
					<div class:added={node.kind === "add"} class:removed={node.kind === "remove"}>
						<code>{node.kind === "add" ? "+" : node.kind === "remove" ? "−" : " "}</code>
						<span>{node.text || " "}</span>
					</div>
				{:else}
					<p>差分はありません。</p>
				{/each}
			</div>
		{/if}
	{/if}
	{#if error}<p class="error">{error}</p>{/if}
</section>

<style>
	.recovery-snapshots {
		margin-top: 1rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	header, .snapshot-actions {
		display: flex;
		gap: .75rem;
		align-items: center;
	}
	header h2 { margin: 0; }
	label { display: grid; gap: .35rem; margin: .75rem 0; }
	.snapshot-diff { margin-top: .75rem; font-family: monospace; }
	.snapshot-diff > div { display: grid; grid-template-columns: 2rem 1fr; white-space: pre-wrap; }
	.snapshot-diff .added { background: #e7f7ed; }
	.snapshot-diff .removed { background: #fdeaea; }
	.error { color: var(--red); }
</style>
