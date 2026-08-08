<script lang="ts">
	import { tick } from "svelte";
	import type { PendingConfirmation } from "./confirmation_controller.svelte.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		pending,
		submitting,
		rewriteBranchName = $bindable(),
		onConfirm,
		onReset,
	}: {
		pending: PendingConfirmation | null;
		submitting: boolean;
		rewriteBranchName: string;
		onConfirm: () => void | Promise<void>;
		onReset: () => void;
	} = $props();

	const vocabulary = useUiVocabulary();
	let dialog: HTMLDialogElement;
	let rewriteInput = $state<HTMLInputElement | null>(null);

	export async function show(focusRewrite: boolean): Promise<void> {
		if (!dialog.open) dialog.showModal();
		if (focusRewrite) {
			await tick();
			rewriteInput?.focus();
		}
	}

	export function close(): void {
		if (!submitting) dialog.close();
	}

	function preventCloseWhileSubmitting(event: Event): void {
		if (submitting) event.preventDefault();
	}
</script>

<dialog
	bind:this={dialog}
	class="confirmation-dialog"
	aria-labelledby="confirmation-title"
	aria-describedby="confirmation-description"
	aria-modal="true"
	oncancel={preventCloseWhileSubmitting}
	onclose={onReset}
>
	{#if pending}
		<div class="confirmation-dialog__content">
			<p class="eyebrow">CONFIRM ACTION</p>
			<h2 id="confirmation-title">
				{pending.action === "trash"
					? `${vocabulary.work}をゴミ箱へ移しますか？`
					: pending.action === "rewrite"
					? `新しい${vocabulary.branch}として書き直しますか？`
					: pending.action === "merge-duplicate"
					? vocabulary.duplicateMergeConfirm
					: pending.action === "cancel-longform"
					? "長文編集をキャンセルしますか？"
					: "完全消去しますか？"}
			</h2>
			<p id="confirmation-description">
				{#if pending.action === "trash"}
					{pending.occurrenceCount}件の{vocabulary.occurrence}と{vocabulary.semanticLink}は保持されます。
				{:else if pending.action === "rewrite"}
					現在の{vocabulary.workingCopy}を分岐点として保存し、元の{vocabulary.branch}を残したまま
					独立した{vocabulary.workingCopy}を作ります。
				{:else if pending.action === "merge-duplicate"}
					{pending.preview.sourceTitle || `(空の${vocabulary.work})`}
					→ {pending.preview.survivorTitle || `(空の${vocabulary.work})`}
					<br />
					{vocabulary.occurrence}: {pending.preview.occurrenceIds.length} /
					{vocabulary.semanticLink}: {pending.preview.links.length}
				{:else if pending.action === "cancel-longform"}
					保存されていない編集内容は失われます。
				{:else}
					{vocabulary.occurrence}{pending.occurrenceCount}件、{vocabulary.semanticLink}{pending.linkCount}件と本文を復元できなくなります。
				{/if}
			</p>
			{#if pending.action === "rewrite"}
				<label>
					{vocabulary.branch}名
					<input
						bind:this={rewriteInput}
						bind:value={rewriteBranchName}
						autocomplete="off"
						onkeydown={(event) => {
							if (event.key === "Enter" && rewriteBranchName.trim()) {
								event.preventDefault();
								void onConfirm();
							}
						}}
					/>
				</label>
			{/if}
			<div class="confirmation-dialog__actions">
				<button onclick={close} disabled={submitting}>キャンセル</button>
				<button
					class:delete={pending.action !== "rewrite"}
					onclick={onConfirm}
					disabled={submitting || (pending.action === "rewrite" && !rewriteBranchName.trim())}
				>
					{submitting
						? "処理中…"
						: pending.action === "trash"
						? "ゴミ箱へ移す"
						: pending.action === "rewrite"
						? `新しい${vocabulary.branch}を作る`
						: pending.action === "merge-duplicate"
						? vocabulary.duplicateMerge
						: pending.action === "cancel-longform"
						? "編集を破棄"
						: "完全消去"}
				</button>
			</div>
		</div>
	{/if}
</dialog>
