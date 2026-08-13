<script lang="ts">
	import { onMount } from "svelte";
	import type { PendingConfirmation } from "../src/ui/confirmation_controller.svelte.ts";
	import ConfirmationDialog from "../src/ui/ConfirmationDialog.svelte";

	let {
		pending,
		submitting = false,
		rewriteBranchName = "",
		onConfirm,
		onReset,
	}: {
		pending: PendingConfirmation;
		submitting?: boolean;
		rewriteBranchName?: string;
		onConfirm: () => void | Promise<void>;
		onReset: () => void;
	} = $props();

	let dialog: ConfirmationDialog;
	onMount(() => void dialog.show(pending.action === "rewrite"));
</script>

<ConfirmationDialog
	bind:this={dialog}
	{pending}
	{submitting}
	bind:rewriteBranchName
	{onConfirm}
	{onReset}
/>
