<script lang="ts">
	import { Tabs } from "bits-ui";
	import { onMount } from "svelte";
	import type { GlobalLineageProjection } from "../services/branch_service";
	import type { GlobalLineageFilter } from "../services/global_lineage_filter";
	import type { UiVocabulary } from "../shared/ui_vocabulary";
	import GlobalLineageDisplayedPane from "./GlobalLineageDisplayedPane.svelte";
	import GlobalLineageFilterPane from "./GlobalLineageFilterPane.svelte";
	import GlobalLineageInspectPane from "./GlobalLineageInspectPane.svelte";
	import type { TreeBounds } from "./tree_camera";
	import type { TreeLayoutNode } from "./tree_layout";

	type SidebarTab = "inspect" | "displayed" | "filter";

	let {
		projection,
		selectedId = null,
		filter,
		inspectCluster,
		activeTab,
		vocabulary,
		onTabChange,
		onFilterChange,
		onSelect,
		onOpen,
		onZoomToCluster,
	}: {
		projection: GlobalLineageProjection;
		selectedId?: string | null;
		filter: GlobalLineageFilter;
		inspectCluster: TreeLayoutNode | null;
		activeTab: SidebarTab;
		vocabulary: UiVocabulary;
		onTabChange: (tab: SidebarTab) => void;
		onFilterChange: (filter: GlobalLineageFilter) => void;
		onSelect: (id: string | null) => void;
		onOpen: (id: string) => void;
		onZoomToCluster: (bounds: TreeBounds | undefined) => void;
	} = $props();

	let drawerOpen = $state(false);
	let lastFocused: Element | null = null;

	onMount(() => {
		const handleKeydown = (event: KeyboardEvent): void => {
			if (event.key === "Escape" && drawerOpen) closeDrawer();
		};
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	});

	function isSidebarTab(value: string): value is SidebarTab {
		return value === "inspect" || value === "displayed" || value === "filter";
	}

	function handleTabChange(value: string): void {
		if (isSidebarTab(value)) onTabChange(value);
	}

	function openDrawer(): void {
		lastFocused = document.activeElement;
		drawerOpen = true;
	}

	function closeDrawer(): void {
		drawerOpen = false;
		if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true });
	}

</script>

{#if drawerOpen}
	<div class="sidebar-backdrop" aria-hidden="true" onclick={closeDrawer}></div>
{/if}
<button
	class="sidebar-toggle"
	type="button"
	aria-expanded={drawerOpen}
	onclick={openDrawer}
>サイドバー</button>

<aside
	class="global-sidebar"
	class:drawer-open={drawerOpen}
	aria-label={`${vocabulary.globalLineage}のサイドバー`}
>
	<Tabs.Root
		value={activeTab}
		orientation="horizontal"
		activationMode="automatic"
		onValueChange={handleTabChange}
	>
		<Tabs.List aria-label="サイドバーの切り替え">
			{#snippet child({ props })}
			<div {...props} class="sidebar-tabs">
				<Tabs.Trigger value="inspect">
					{#snippet child({ props: triggerProps })}
						<button
							{...triggerProps}
							type="button"
							class={activeTab === "inspect" ? "active" : ""}
						>切り出し</button>
					{/snippet}
				</Tabs.Trigger>
				<Tabs.Trigger value="displayed">
					{#snippet child({ props: triggerProps })}
						<button
							{...triggerProps}
							type="button"
							class={activeTab === "displayed" ? "active" : ""}
						>表示中</button>
					{/snippet}
				</Tabs.Trigger>
				<Tabs.Trigger value="filter">
					{#snippet child({ props: triggerProps })}
						<button
							{...triggerProps}
							type="button"
							class={activeTab === "filter" ? "active" : ""}
						>フィルター</button>
					{/snippet}
				</Tabs.Trigger>
			</div>
			{/snippet}
		</Tabs.List>
		<GlobalLineageInspectPane
			{projection}
			{inspectCluster}
			{selectedId}
			{onSelect}
			{onOpen}
			{onZoomToCluster}
		/>
		<GlobalLineageDisplayedPane {projection} {vocabulary} />
		<GlobalLineageFilterPane {filter} {vocabulary} {onFilterChange} />
	</Tabs.Root>
	<button class="sidebar-close" type="button" aria-label="閉じる" onclick={closeDrawer}>×</button>
</aside>

<style>
	.sidebar-toggle {
		display: none;
	}
	.sidebar-backdrop {
		display: none;
	}
	.global-sidebar {
		position: absolute;
		z-index: 3;
		inset: 0 0 0 auto;
		width: 320px;
		padding: 22px 16px;
		border-left: 1px solid var(--border);
		background: color-mix(in srgb, var(--surface) 96%, transparent);
		overflow: auto;
	}
	.sidebar-tabs {
		display: flex;
		gap: 6px;
		margin-bottom: 16px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 7px;
	}
	.sidebar-tabs button {
		flex: 1;
		height: 28px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--muted);
		font-size: 11px;
		cursor: pointer;
	}
	.sidebar-tabs button:hover {
		color: var(--text);
	}
	.sidebar-tabs button[data-state="active"] {
		background: var(--surface-hover);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--cyan);
	}
	.sidebar-close {
		display: none;
	}
	@media (max-width: 1000px) {
		.sidebar-toggle {
			position: absolute;
			z-index: 4;
			top: 22px;
			right: 22px;
			display: block;
			height: 30px;
			padding: 0 12px;
			border: 1px solid var(--border-bright);
			border-radius: 6px;
			background: color-mix(in srgb, var(--surface) 88%, transparent);
			color: var(--text);
			font-size: 11px;
			cursor: pointer;
		}
		.sidebar-backdrop {
			position: absolute;
			z-index: 3;
			inset: 0;
			display: block;
			background: rgb(0 0 0 / 45%);
		}
		.global-sidebar {
			width: min(360px, 85vw);
			transform: translateX(100%);
			transition: transform .22s ease;
			box-shadow: -10px 0 30px rgb(0 0 0 / 45%);
		}
		.global-sidebar.drawer-open {
			transform: translateX(0);
		}
		.sidebar-close {
			position: absolute;
			top: 18px;
			right: 16px;
			display: block;
			width: 28px;
			height: 28px;
			border: 1px solid var(--border-bright);
			border-radius: 5px;
			background: var(--surface-raised);
			color: var(--text);
			font-size: 15px;
			cursor: pointer;
		}
	}
</style>
