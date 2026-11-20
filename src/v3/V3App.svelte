<script lang="ts">
import type { BodyEditorController } from "./body_editor_controller.svelte.ts";

/** View only: reads controller state and forwards user operations. No I/O here. */
let { controller }: { controller: BodyEditorController } = $props();

const STATUS_LABEL = {
	idle: "",
	saving: "保存中…",
	saved: "保存しました",
	failed: "保存できませんでした",
	conflict: "最新の内容を読み込みました",
} as const;

function onKeydown(event: KeyboardEvent): void {
	if ((event.ctrlKey || event.metaKey) && event.key === "s") {
		event.preventDefault();
		void controller.save();
	}
}
</script>

<div class="shell">
	{#if controller.loadState === "loading"}
		<p class="notice">ワークスペースを読み込んでいます…</p>
	{:else if controller.loadState === "unavailable"}
		<div class="notice" role="alert">
			<p>ワークスペースを開けませんでした。</p>
			<p>{controller.unavailableMessage}</p>
		</div>
	{:else}
		<nav class="documents" aria-label="文書">
			<button
				type="button"
				class="new"
				disabled={controller.busy || controller.canRetry}
				onclick={() => controller.createDocument()}
			>
				新しい文書
			</button>
			<ul>
				{#each controller.documents as document (document.id)}
					<li>
						<button
							type="button"
							class:selected={document.id === controller.selectedId}
							aria-current={document.id === controller.selectedId ? "true" : undefined}
							onclick={() => controller.select(document.id)}
						>
							{document.title}{#if document.dirty}<span class="dirty" aria-hidden="true">●</span
								><span class="visually-hidden">（未保存）</span>{/if}
						</button>
					</li>
				{:else}
					<li class="empty">文書はまだありません</li>
				{/each}
			</ul>
		</nav>

		<main class="editor">
			{#if controller.selectedId}
				<textarea
					aria-label="本文"
					value={controller.text}
					oninput={(event) => controller.input(event.currentTarget.value)}
					onblur={() => controller.save()}
					onkeydown={onKeydown}
				></textarea>
			{:else}
				<p class="notice">「新しい文書」で文書を作成してください。</p>
			{/if}

			<footer class="status" aria-live="polite">
				<span>{STATUS_LABEL[controller.status]}</span>
				{#if controller.statusMessage}<span class="message">{controller.statusMessage}</span>{/if}
				{#if controller.canRetry}
					<button type="button" onclick={() => controller.retry()}>再試行</button>
				{/if}
				<button
					type="button"
					disabled={controller.busy || !controller.selectedId}
					onclick={() => controller.save()}
				>
					保存
				</button>
				{#if controller.version !== null}<span class="version">版 {controller.version}</span>{/if}
			</footer>
		</main>
	{/if}
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: minmax(12rem, 16rem) 1fr;
		height: 100vh;
		color: var(--v3-text);
		background: var(--v3-bg);
		font-family: system-ui, sans-serif;
	}

	.notice {
		grid-column: 1 / -1;
		padding: 2rem;
	}

	.documents {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border-right: 1px solid var(--v3-border);
		overflow-y: auto;
	}

	.documents ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.documents li button {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: 0.25rem;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.documents li button.selected {
		background: var(--v3-selected);
	}

	.empty {
		padding: 0.4rem 0.5rem;
		color: var(--v3-muted);
	}

	.dirty {
		margin-left: 0.25rem;
		color: var(--v3-accent);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.editor {
		display: grid;
		grid-template-rows: 1fr auto;
		min-width: 0;
	}

	textarea {
		padding: 1rem;
		border: none;
		resize: none;
		background: var(--v3-bg);
		color: inherit;
		font: inherit;
		font-size: 1rem;
		line-height: 1.7;
	}

	textarea:focus {
		outline: 2px solid var(--v3-accent);
		outline-offset: -2px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--v3-border);
		font-size: 0.875rem;
	}

	.message {
		color: var(--v3-muted);
	}

	.version {
		margin-left: auto;
		color: var(--v3-muted);
	}
</style>
