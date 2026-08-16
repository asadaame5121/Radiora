<script lang="ts">
	import { onDestroy } from "svelte";
	import type { ContextMenuItem } from "../src/ui/context_menu.ts";
	import ContextMenu from "../src/ui/ContextMenu.svelte";

	let {
		items,
		onSelect,
		onClose,
	}: {
		items: readonly ContextMenuItem[];
		onSelect: (id: string) => void;
		onClose: () => void;
	} = $props();

	let open = $state(false);
	let x = $state(0);
	let y = $state(0);
	let triggerElement = $state<HTMLButtonElement>();
	let menu = $state<ContextMenu>();

	onDestroy(() => {
		menu?.close();
	});

	function openMenu(event: MouseEvent): void {
		event.preventDefault();
		x = event.clientX;
		y = event.clientY;
		open = true;
	}

	function openMenuFromKeyboard(event: KeyboardEvent): void {
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
		event.preventDefault();
		const rect = triggerElement?.getBoundingClientRect();
		x = rect?.left ?? 8;
		y = rect?.bottom ?? 8;
		open = true;
	}

	function closeMenu(): void {
		open = false;
		onClose();
	}
</script>

<div class="context-menu-story">
	<button
		bind:this={triggerElement}
		type="button"
		oncontextmenu={openMenu}
		onkeydown={openMenuFromKeyboard}
	>
		項目メニューを開く
	</button>
	{#if open}
		<ContextMenu
			bind:this={menu}
			{items}
			{x}
			{y}
			{triggerElement}
			onSelect={onSelect}
			onClose={closeMenu}
		/>
	{/if}
</div>

<style>
	.context-menu-story {
		min-height: 260px;
		padding: 48px;
		background: var(--surface);
	}
</style>
