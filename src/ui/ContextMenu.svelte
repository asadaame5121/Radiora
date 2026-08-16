<script lang="ts">
	import { ContextMenu as BitsContextMenu } from "bits-ui";
	import type { ContextMenuItem } from "./context_menu";

	const COLLISION_PADDING = 8;

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

	let open = $state(true);
	let anchorElement = $state<HTMLDivElement | null>(null);
	let contentElement = $state<HTMLDivElement | null>(null);
	let closeNotified = false;

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) closeNotified = false;
	}

	function handleOpenChangeComplete(nextOpen: boolean): void {
		if (!nextOpen && !closeNotified) {
			closeNotified = true;
			onClose();
		}
	}

	export function close(): void {
		open = false;
	}

	function handleItemSelect(id: string): void {
		onSelect(id);
		if (!closeNotified) {
			closeNotified = true;
			onClose();
		}
		open = false;
	}

	function handleCloseAutoFocus(event: Event): void {
		event.preventDefault();
		triggerElement?.focus();
	}

	function handleOpenAutoFocus(event: Event): void {
		if (!contentElement) return;
		event.preventDefault();
		contentElement.focus();
	}
</script>

<BitsContextMenu.Root
	bind:open
	onOpenChange={handleOpenChange}
	onOpenChangeComplete={handleOpenChangeComplete}
>
	<div
		bind:this={anchorElement}
		class="context-menu-anchor"
		aria-hidden="true"
		style:left={`${x}px`}
		style:top={`${y}px`}
	></div>
	<BitsContextMenu.Content
		customAnchor={anchorElement}
		strategy="fixed"
		avoidCollisions={true}
		collisionPadding={COLLISION_PADDING}
		side="right"
		sideOffset={0}
		align="start"
		onOpenAutoFocus={handleOpenAutoFocus}
		onCloseAutoFocus={handleCloseAutoFocus}
	>
		{#snippet child({ props })}
			<div bind:this={contentElement} {...props} class="context-menu">
				{#each items as item (item.id)}
					{#if item.separatorBefore}
						<BitsContextMenu.Separator>
							{#snippet child({ props: separatorProps })}
								<div {...separatorProps} class="context-menu-separator"></div>
							{/snippet}
						</BitsContextMenu.Separator>
					{/if}
					<BitsContextMenu.Item
						disabled={item.disabled}
						onSelect={() => handleItemSelect(item.id)}
					>
						{#snippet child({ props: itemProps })}
							<button
								{...itemProps}
								class:danger={item.danger}
								class="context-menu-item"
								disabled={item.disabled}
								title={item.disabled && item.reason ? item.reason : undefined}
								type="button"
							>
								{item.label}
							</button>
						{/snippet}
					</BitsContextMenu.Item>
				{/each}
			</div>
		{/snippet}
	</BitsContextMenu.Content>
</BitsContextMenu.Root>

<style>
	.context-menu-anchor {
		position: fixed;
		width: 0;
		height: 0;
		pointer-events: none;
	}

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
