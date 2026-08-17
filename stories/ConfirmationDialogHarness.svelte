<script lang="ts">
	import { onMount } from "svelte";
	import type { PendingConfirmation } from "../src/ui/confirmation_controller.svelte.ts";
	import ConfirmationDialog from "../src/ui/ConfirmationDialog.svelte";

	let {
		pending,
		submitting = false,
		rewriteBranchName = "",
		restoreFocus = false,
		onConfirm,
		onReset,
	}: {
		pending: PendingConfirmation;
		submitting?: boolean;
		rewriteBranchName?: string;
		restoreFocus?: boolean;
		onConfirm: () => void | Promise<void>;
		onReset: () => void;
	} = $props();

	let dialog: ConfirmationDialog;
	let focusReturnTarget = $state<HTMLButtonElement>();

	async function confirm(): Promise<void> {
		await onConfirm();
		dialog.close();
	}

	onMount(() => {
		if (restoreFocus) focusReturnTarget?.focus();
		void dialog.show(pending.action === "rewrite");
	});
</script>

{#if restoreFocus}
	<button bind:this={focusReturnTarget} class="focus-return-target" type="button">フォーカスの戻り先</button>
{/if}

<ConfirmationDialog
	bind:this={dialog}
	{pending}
	{submitting}
	bind:rewriteBranchName
	onConfirm={confirm}
	{onReset}
/>

<style>
	.focus-return-target {
		position: fixed;
		inset: 0 auto auto 0;
		opacity: 0;
	}
</style>
