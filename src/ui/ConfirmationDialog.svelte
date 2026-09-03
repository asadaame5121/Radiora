<script lang="ts">
	import { tick } from "svelte";
	import { Dialog } from "bits-ui";
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
	let open = $state(false);
	let focusRewrite = $state(false);
	let rewriteInput = $state<HTMLInputElement | null>(null);
	let resetNotified = false;

	export async function show(shouldFocusRewrite: boolean): Promise<void> {
		focusRewrite = shouldFocusRewrite;
		if (!open) {
			open = true;
			await tick();
		} else if (shouldFocusRewrite) {
			await tick();
			rewriteInput?.focus();
		}
	}

	export function close(): void {
		if (!submitting) open = false;
	}

	function handleOpenChange(nextOpen: boolean): void {
		if (!nextOpen && submitting) {
			open = true;
			return;
		}
		open = nextOpen;
		if (!nextOpen && !resetNotified) {
			resetNotified = true;
			onReset();
		}
		if (nextOpen) resetNotified = false;
	}

	function handleOpenAutoFocus(event: Event): void {
		if (!focusRewrite) return;
		event.preventDefault();
		rewriteInput?.focus();
	}

	function handleOpenChangeComplete(nextOpen: boolean): void {
		if (!nextOpen && !open && !resetNotified) {
			resetNotified = true;
			onReset();
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={handleOpenChange}
	onOpenChangeComplete={handleOpenChangeComplete}
>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="confirmation-dialog__overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content onOpenAutoFocus={handleOpenAutoFocus}>
			{#snippet child({ props })}
				<div
					{...props}
					role="dialog"
					class="confirmation-dialog"
					aria-labelledby="confirmation-title"
					aria-describedby="confirmation-description"
					aria-modal="true"
				>
					{#if pending}
						<div class="confirmation-dialog__content">
							<p class="eyebrow">CONFIRM ACTION</p>
							<Dialog.Title>
								{#snippet child({ props: titleProps })}
									<h2 {...titleProps} id="confirmation-title">
										{pending.action === "trash"
											? `${vocabulary.work}をゴミ箱へ移しますか？`
											: pending.action === "rewrite"
											? `新しい${vocabulary.branch}として書き直しますか？`
											: pending.action === "merge-duplicate"
											? vocabulary.duplicateMergeConfirm
											: pending.action === "cancel-longform"
											? "原稿の編集をキャンセルしますか？"
											: "完全消去しますか？"}
									</h2>
								{/snippet}
							</Dialog.Title>
							<Dialog.Description>
								{#snippet child({ props: descriptionProps })}
									<p {...descriptionProps} id="confirmation-description">
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
								{/snippet}
							</Dialog.Description>
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
								<Dialog.Close disabled={submitting}>
									{#snippet child({ props: cancelProps })}
										<button {...cancelProps} type="button" disabled={submitting}>キャンセル</button>
									{/snippet}
								</Dialog.Close>
								<button
									type="button"
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
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.confirmation-dialog__overlay {
		position: fixed;
		inset: 0;
		z-index: 999;
		background: rgb(0 0 0 / 64%);
		backdrop-filter: blur(3px);
	}

	.confirmation-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 1000;
		width: min(440px, calc(100vw - 48px));
		background: var(--surface-raised);
		border: 1px solid var(--border-bright);
		border-radius: 10px;
		box-shadow: 0 24px 80px #000c;
	}

	.confirmation-dialog__content {
		padding: 20px 24px 24px;
	}

	.confirmation-dialog h2 {
		margin: 8px 0 12px;
		font-family: var(--font-serif);
		font-size: 20px;
		font-weight: normal;
		color: var(--theme-text, #edf9fa);
	}

	.confirmation-dialog p:not(.eyebrow) {
		margin: 0;
		color: var(--theme-muted, #afc1c9);
		font-size: 13px;
		line-height: 1.65;
	}

	.confirmation-dialog__actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 22px;
	}

	.confirmation-dialog__actions button {
		padding: 8px 12px;
	}

	.confirmation-dialog__actions .delete {
		color: #ffd2cd;
		border-color: #773942;
		background: #4b2028;
		opacity: 1;
	}

	.confirmation-dialog__actions button:disabled {
		cursor: wait;
		opacity: .6;
	}
</style>
