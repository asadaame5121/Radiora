<script lang="ts">
	import { onMount, tick } from "svelte";
	import {
		contextMenuPosition,
		firstEnabledContextMenuIndex,
		lastEnabledContextMenuIndex,
		nextEnabledContextMenuIndex,
		type ContextMenuItem,
	} from "./context_menu";

	let {
		items,
		x,
		y,
		triggerElement = null,
		onSelect,
		onClose,
	}: {
		items: readonly ContextMenuItem[];
		x: number;
		y: number;
		/** Element which opened the menu and receives focus after it closes. */
		triggerElement?: HTMLElement | SVGElement | null;
		onSelect: (id: string) => void;
		onClose: () => void;
	} = $props();

	let menuElement: HTMLDivElement | undefined;
	let position = $state({ left: 0, top: 0 });
	let closed = false;

	function close(): void {
		if (closed) return;
		closed = true;
		triggerElement?.focus();
		onClose();
	}

	function select(item: ContextMenuItem): void {
		if (item.disabled) return;
		onSelect(item.id);
		close();
	}

	function focusItem(index: number): void {
		if (index < 0) {
			menuElement?.focus();
			return;
		}
		const id = items[index]?.id;
		if (!id) return;
		menuElement?.querySelector<HTMLButtonElement>(`button[data-menu-id="${CSS.escape(id)}"]`)?.focus();
	}

	function currentIndex(): number {
		const active = document.activeElement as HTMLElement | null;
		const id = active?.dataset.menuId;
		return id ? items.findIndex((item) => item.id === id) : -1;
	}

	function handleKeydown(event: KeyboardEvent): void {
		const current = currentIndex();
		let next = -1;
		switch (event.key) {
			case "ArrowDown":
				next = nextEnabledContextMenuIndex(items, current, 1);
				break;
			case "ArrowUp":
				next = nextEnabledContextMenuIndex(items, current, -1);
				break;
			case "Home":
				next = firstEnabledContextMenuIndex(items);
				break;
			case "End":
				next = lastEnabledContextMenuIndex(items);
				break;
			case "Enter":
			case " ": {
				const item = items[current];
				if (!item) return;
				event.preventDefault();
				select(item);
				return;
			}
			case "Escape":
				event.preventDefault();
				close();
				return;
			default:
				return;
		}
		event.preventDefault();
		focusItem(next);
	}

	async function reposition(): Promise<void> {
		await tick();
		if (!menuElement) return;
		const rect = menuElement.getBoundingClientRect();
		position = contextMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
	}

	function handleOutsidePointerDown(event: PointerEvent): void {
		if (menuElement?.contains(event.target as Node)) return;
		close();
	}

	function handleViewportChange(): void {
		close();
	}

	$effect(() => {
		void x;
		void y;
		void items;
		void reposition();
	});

	onMount(() => {
		const initialIndex = firstEnabledContextMenuIndex(items);
		focusItem(initialIndex);
		window.addEventListener("pointerdown", handleOutsidePointerDown, true);
		window.addEventListener("scroll", handleViewportChange, true);
		window.addEventListener("resize", handleViewportChange);
		return () => {
			window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
			window.removeEventListener("scroll", handleViewportChange, true);
			window.removeEventListener("resize", handleViewportChange);
		};
	});
</script>

<div
	bind:this={menuElement}
	class="context-menu"
	role="menu"
	tabindex="-1"
	style:left={`${position.left}px`}
	style:top={`${position.top}px`}
	onkeydown={handleKeydown}
>
	{#each items as item (item.id)}
		{#if item.separatorBefore}
			<div class="context-menu-separator" role="separator"></div>
		{/if}
		<button
			class:danger={item.danger}
			class="context-menu-item"
			data-menu-id={item.id}
			disabled={item.disabled}
			role="menuitem"
			title={item.disabled && item.reason ? item.reason : undefined}
			type="button"
			onclick={() => select(item)}
		>
			{item.label}
		</button>
	{/each}
</div>

<style>
	.context-menu {
		position: fixed;
		z-index: 1000;
		min-width: 13rem;
		max-width: min(22rem, calc(100vw - 1rem));
		padding: 0.3rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 0.55rem;
		background: var(--surface-raised, Canvas);
		box-shadow: 0 0.7rem 1.8rem color-mix(in srgb, black 20%, transparent);
	}

	.context-menu-item {
		display: block;
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.context-menu-item:hover:not(:disabled),
	.context-menu-item:focus-visible {
		outline: none;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	.context-menu-item:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.context-menu-item.danger {
		color: var(--red, #ef5b5b);
	}

	.context-menu-separator {
		height: 1px;
		margin: 0.3rem 0.15rem;
		background: color-mix(in srgb, currentColor 18%, transparent);
	}
</style>
