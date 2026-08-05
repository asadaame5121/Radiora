<script lang="ts">
	import { onMount } from "svelte";
	import { LINK_TYPES, type LinkType } from "../domain/models";
	import type { GlobalLineageProjection } from "../services/branch_service";
	import type { GlobalLineageFilter } from "../services/global_lineage_filter";
	import type { TreeLayoutNode } from "./tree_layout";
	import { buildLaneOrder, labelForItem } from "./tree_layout";
	import PhylogeneticTree from "./PhylogeneticTree.svelte";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		projection,
		selectedId = null,
		filter,
		onFilterChange,
		onSelect,
		onOpen,
		onContextMenu,
		onProjectionChange,
	}: {
		projection: GlobalLineageProjection;
		selectedId?: string | null;
		filter: GlobalLineageFilter;
		onFilterChange: (filter: GlobalLineageFilter) => void;
		onSelect: (id: string | null) => void;
		onOpen: (id: string) => void;
		onContextMenu: (id: string, event: MouseEvent | KeyboardEvent) => void;
		onProjectionChange?: (projection: import("./tree_layout").TreeProjection) => void;
	} = $props();

	const vocabulary = useUiVocabulary();

	type SidebarTab = "inspect" | "displayed" | "filter";
	let activeTab = $state<SidebarTab>("displayed");
	let inspectCluster = $state<TreeLayoutNode | null>(null);
	let treeElement: PhylogeneticTree | null = null;
	let drawerOpen = $state(false);
	let lastFocused: Element | null = null;

	const itemById = $derived(new Map(projection.snapshot.items.map((item) => [item.id, item])));
	const workLabelByItemId = $derived.by(() => {
		const result = new Map<string, string>();
		for (const item of projection.snapshot.items) result.set(item.id, labelForItem(item.text).label);
		return result;
	});
	const clusterMembers = $derived.by(() => {
		if (!inspectCluster) return [];
		const order = buildLaneOrder(projection.snapshot);
		return [...inspectCluster.itemIds]
			.map((id) => itemById.get(id))
			.filter((item) => item !== undefined)
			.sort((a, b) =>
				(order.get(a!.id) ?? 0) - (order.get(b!.id) ?? 0) ||
				a!.id.localeCompare(b!.id)
			);
	});
	const activeConditionCount = $derived(
		(LINK_TYPES.length - filter.linkTypes.length) + (filter.includeIsolated ? 0 : 1),
	);
	const isFilterActive = $derived(
		projection.filteredWorkCount < projection.totalWorkCount || activeConditionCount > 0,
	);

	$effect(() => {
		// When the filter changes remove the inspected cluster, close the
		// inspection pane and reveal the filter tab so the cause is visible.
		if (!inspectCluster) return;
		const present = inspectCluster.itemIds.every((id) => itemById.get(id) !== undefined);
		if (present) return;
		inspectCluster = null;
		activeTab = "filter";
	});

	onMount(() => {
		const handleKeydown = (event: KeyboardEvent): void => {
			if (event.key === "Escape" && drawerOpen) closeDrawer();
		};
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	});

	function revisionLabel(createdAt: string, message?: string): string {
		const parsed = new Date(createdAt);
		const date = Number.isNaN(parsed.getTime())
			? "日時不明"
			: parsed.toLocaleDateString("ja-JP");
		return message ? `${date} · ${message}` : date;
	}

	function handleInspectCluster(cluster: TreeLayoutNode): void {
		inspectCluster = cluster;
		activeTab = "inspect";
	}

	function setIncludeIsolated(includeIsolated: boolean): void {
		onFilterChange({ ...filter, includeIsolated });
	}

	function setLinkType(type: LinkType, enabled: boolean): void {
		const linkTypes = enabled
			? [...filter.linkTypes, type]
			: filter.linkTypes.filter((candidate) => candidate !== type);
		onFilterChange({ ...filter, linkTypes });
	}

	function selectAllLinkTypes(): void {
		onFilterChange({ ...filter, linkTypes: [...LINK_TYPES] });
	}

	function clearLinkTypes(): void {
		onFilterChange({ ...filter, linkTypes: [] });
	}

	function zoomToCluster(): void {
		if (!inspectCluster?.bounds) return;
		treeElement?.zoomToBounds(inspectCluster.bounds);
	}

	function openDrawer(): void {
		lastFocused = document.activeElement;
		drawerOpen = true;
	}

	function closeDrawer(): void {
		drawerOpen = false;
		if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true });
	}

	function internalLinks(itemId: string): Array<{ type: LinkType; targetLabel: string }> {
		if (!inspectCluster) return [];
		const memberIds = new Set(inspectCluster.itemIds);
		const workId = itemById.get(itemId)?.workId;
		const result: Array<{ type: LinkType; targetLabel: string }> = [];
		for (const link of projection.snapshot.links) {
			if (link.status === "retracted") continue;
			const fromId = [...projection.snapshot.items]
				.find((item) => item.workId === link.from.workId)?.id;
			const toId = [...projection.snapshot.items]
				.find((item) => item.workId === link.to.workId)?.id;
			if (fromId === undefined || toId === undefined) continue;
			if (link.from.workId !== workId && link.to.workId !== workId) continue;
			const targetId = link.from.workId === workId ? toId : fromId;
			const targetLabel = workLabelByItemId.get(targetId);
			if (memberIds.has(targetId) && targetLabel !== undefined) {
				result.push({ type: link.type, targetLabel });
			}
		}
		return result;
	}

	function externalStubs(itemId: string): LinkType[] {
		if (!inspectCluster) return [];
		const memberIds = new Set(inspectCluster.itemIds);
		const memberWorkIds = new Set(
			[...memberIds].map((id) => itemById.get(id)?.workId).filter((id) => id !== undefined),
		);
		const workId = itemById.get(itemId)?.workId;
		const result: LinkType[] = [];
		for (const link of projection.snapshot.links) {
			if (link.status === "retracted") continue;
			if (link.from.workId !== workId && link.to.workId !== workId) continue;
			const other = link.from.workId === workId ? link.to.workId : link.from.workId;
			if (!memberWorkIds.has(other)) result.push(link.type);
		}
		return [...new Set(result)];
	}
</script>

<section class="global-lineage" aria-label={vocabulary.globalLineage}>
	<div class="lineage-heading">
		<p class="eyebrow">GLOBAL LINEAGE</p>
		<h1>{vocabulary.globalLineage}</h1>
		<p>
			{vocabulary.work}同士の意味関係を表示します。明示した{vocabulary.branch}と
			その確定済み先端の{vocabulary.revision}だけが右側に現れます。
		</p>
		{#if isFilterActive}
			<p class="filter-summary" aria-label="表示件数">
				表示中 {projection.filteredWorkCount} / {projection.totalWorkCount}件
				{activeConditionCount > 0 ? `・条件 ${activeConditionCount}件有効` : ""}
			</p>
		{/if}
	</div>
	<div class="global-tree">
		<PhylogeneticTree
			bind:this={treeElement}
			snapshot={projection.snapshot}
			{selectedId}
			{onSelect}
			{onOpen}
			{onContextMenu}
			{onProjectionChange}
			onInspectCluster={handleInspectCluster}
		/>
	</div>

	{#if drawerOpen}
		<div class="sidebar-backdrop" aria-hidden="true" onclick={closeDrawer}></div>
	{/if}
	<button
		class="sidebar-toggle"
		aria-expanded={drawerOpen}
		onclick={openDrawer}
	>サイドバー</button>

	<aside
		class="global-sidebar"
		class:drawer-open={drawerOpen}
		aria-label={`${vocabulary.globalLineage}のサイドバー`}
	>
		<nav class="sidebar-tabs" aria-label="サイドバーの切り替え">
			<button
				class:active={activeTab === "inspect"}
				onclick={() => (activeTab = "inspect")}
			>切り出し</button>
			<button
				class:active={activeTab === "displayed"}
				onclick={() => (activeTab = "displayed")}
			>表示中</button>
			<button
				class:active={activeTab === "filter"}
				onclick={() => (activeTab = "filter")}
			>フィルター</button>
		</nav>
		<button class="sidebar-close" aria-label="閉じる" onclick={closeDrawer}>×</button>

		{#if activeTab === "inspect"}
			<div class="sidebar-pane">
				{#if inspectCluster}
					<header class="pane-heading">
						<p class="eyebrow">クラスタの切り出し</p>
						<h2>{inspectCluster.count}件の思索</h2>
						<button onclick={zoomToCluster}>中央で拡大</button>
					</header>
					<ol class="cluster-members">
						{#each clusterMembers as member (member.id)}
							{@const internal = internalLinks(member.id)}
							{@const external = externalStubs(member.id)}
							<li class:selected={member.id === selectedId}>
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="member-main"
									role="button"
									tabindex="0"
									aria-label={labelForItem(member.text).label}
									onclick={() => onSelect(member.id)}
									ondblclick={() => onOpen(member.id)}
									onkeydown={(event) => {
										if (event.key !== "Enter" && event.key !== " ") return;
										event.preventDefault();
										onSelect(member.id);
									}}
								>
									<p class="member-label">{labelForItem(member.text).label}</p>
									{#if internal.length > 0 || external.length > 0}
										<div class="member-links" aria-label="構成ノードの意味リンク">
											{#each internal as link (link.type + link.targetLabel)}
												<span class="link-chip type-{link.type.toLowerCase()}">
													{link.type} → {link.targetLabel}
												</span>
											{/each}
											{#each external as type (type)}
												<span class="link-stub type-{type.toLowerCase()}">{type} → 外部</span>
											{/each}
										</div>
									{/if}
								</div>
								<button class="open-member" onclick={() => onOpen(member.id)}>開く</button>
							</li>
						{/each}
					</ol>
				{:else}
					<p class="pane-empty">クラスタを選ぶと、構成項目をここで確認できます。</p>
				{/if}
			</div>
		{:else if activeTab === "displayed"}
			<div class="sidebar-pane promoted-lineage" aria-label={`${vocabulary.globalLineage}に表示した${vocabulary.branch}`}>
				<header class="pane-heading">
					<p class="eyebrow">PROMOTED</p>
					<h2>{vocabulary.globalLineage}に表示中</h2>
				</header>
				{#each projection.promotedBranches as entry (entry.branch.id)}
					<article>
						<div>
							<span class="lineage-kind">{vocabulary.branch}</span>
							<strong>{entry.branch.name}</strong>
						</div>
						{#if entry.headRevision}
							<p>
								<span class="lineage-kind">{vocabulary.revision}</span>
								{revisionLabel(entry.headRevision.createdAt, entry.headRevision.message)}
							</p>
						{:else}
							<p class="muted">確定した{vocabulary.revision}はありません</p>
						{/if}
					</article>
				{:else}
					<p class="empty">明示して表示した{vocabulary.branch}はありません。</p>
				{/each}
			</div>
		{:else}
			<div class="sidebar-pane filter-pane">
				<header class="pane-heading">
					<p class="eyebrow">FILTERS</p>
					<h2>表示条件</h2>
				</header>
				<label class="filter-toggle">
					<input
						type="checkbox"
						checked={filter.includeIsolated}
						onchange={(event) => setIncludeIsolated(event.currentTarget.checked)}
					/>
					孤立{vocabulary.work}を表示
				</label>
				<div class="filter-types">
					{#each [...LINK_TYPES] as type (type)}
						<label class="filter-toggle">
							<input
								type="checkbox"
								checked={filter.linkTypes.includes(type)}
								onchange={(event) => setLinkType(type, event.currentTarget.checked)}
							/>
							{type}
						</label>
					{/each}
				</div>
				<div class="filter-actions">
					<button onclick={selectAllLinkTypes}>すべて選択</button>
					<button onclick={clearLinkTypes}>すべて解除</button>
				</div>
			</div>
		{/if}
	</aside>
</section>

<style>
	.global-lineage {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: #050a10;
	}
	.lineage-heading {
		position: absolute;
		z-index: 2;
		top: 20px;
		left: 22px;
		max-width: 390px;
		padding: 12px 14px;
		border: 1px solid #17313e;
		border-radius: 8px;
		background: rgb(5 10 16 / 88%);
		pointer-events: none;
	}
	.lineage-heading p,
	.lineage-heading h1 {
		margin: 0;
	}
	.lineage-heading h1 {
		margin-top: 3px;
		color: #eafcfd;
		font: 22px Georgia, "Noto Serif JP", serif;
	}
	.lineage-heading > p:last-child {
		margin-top: 5px;
		color: #7f949e;
		font-size: 11px;
		line-height: 1.6;
	}
	.lineage-heading .filter-summary {
		margin-top: 6px;
		color: #f2a93b;
		font-size: 10px;
	}
	.global-tree {
		position: absolute;
		inset: 0 320px 0 0;
	}
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
		border-left: 1px solid #17313e;
		background: rgb(8 16 26 / 96%);
		overflow: auto;
	}
	.sidebar-tabs {
		display: flex;
		gap: 6px;
		margin-bottom: 16px;
		padding: 3px;
		border: 1px solid #28546a;
		border-radius: 7px;
	}
	.sidebar-tabs button {
		flex: 1;
		height: 28px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: #7f949e;
		font-size: 11px;
		cursor: pointer;
	}
	.sidebar-tabs button:hover {
		color: #dce7ec;
	}
	.sidebar-tabs button.active {
		background: #12303d;
		color: #eafcfd;
		box-shadow: inset 0 0 0 1px rgb(37 198 209 / 42%);
	}
	.sidebar-close {
		display: none;
	}
	.sidebar-pane {
		min-width: 0;
	}
	.pane-heading h2 {
		margin: 3px 0 12px;
		color: #dce7ec;
		font-size: 13px;
	}
	.pane-heading button {
		margin-bottom: 10px;
		border: 1px solid #28546a;
		border-radius: 5px;
		background: #0d1b26;
		color: #b6c9d1;
		font-size: 10px;
		line-height: 26px;
		cursor: pointer;
	}
	.pane-heading button:hover {
		border-color: #25c6d1;
		color: #eafcfd;
	}
	.pane-empty,
	.empty {
		color: #657681;
		font-size: 11px;
		line-height: 1.6;
	}
	.cluster-members {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.cluster-members li {
		position: relative;
		margin-bottom: 8px;
		padding: 10px;
		border: 1px solid #17313e;
		border-radius: 7px;
		background: #07121a;
		cursor: pointer;
		outline: none;
	}
	.cluster-members li:hover,
	.cluster-members li:has(.member-main:hover),
	.cluster-members li:has(.member-main:focus),
	.cluster-members li.selected {
		border-color: #25c6d1;
		background: #0c1c27;
	}
	.cluster-members li.selected {
		box-shadow: inset 0 0 0 1px rgb(242 169 59 / 55%);
	}
	.member-label {
		margin: 0;
		color: #dce7ec;
		font-size: 12px;
		line-height: 1.5;
	}
	.member-links {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 8px;
	}
	.link-chip,
	.link-stub {
		padding: 2px 6px;
		border: 1px solid #28546a;
		border-radius: 4px;
		color: #9fb3bc;
		font-size: 9px;
	}
	.link-chip.type-from {
		border-color: #25c6d1;
		color: #73dce3;
	}
	.link-chip.type-like {
		border-color: #a855f7;
		color: #c9a1f2;
	}
	.link-chip.type-fix {
		border-color: #f2a93b;
		color: #f2c17e;
	}
	.link-chip.type-vs {
		border-color: #ef5b5b;
		color: #f2a0a0;
	}
	.link-stub {
		border-style: dashed;
		opacity: .7;
	}
	.open-member {
		margin-top: 8px;
		border: 1px solid #28546a;
		border-radius: 4px;
		background: #0d1b26;
		color: #b6c9d1;
		font-size: 10px;
		line-height: 24px;
		cursor: pointer;
	}
	.open-member:hover {
		border-color: #25c6d1;
		color: #eafcfd;
	}
	.promoted-lineage article {
		margin-bottom: 10px;
		padding: 11px;
		border: 1px solid #17313e;
		border-radius: 7px;
		background: #07121a;
	}
	.promoted-lineage article div {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.promoted-lineage article p {
		margin: 8px 0 0;
		color: #9fb3bc;
		font-size: 11px;
	}
	.lineage-kind {
		padding: 2px 5px;
		border: 1px solid #28546a;
		border-radius: 4px;
		color: #73dce3;
		font-size: 9px;
	}
	.muted {
		color: #657681;
		font-size: 11px;
		line-height: 1.6;
	}
	.filter-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 9px;
		color: #b6c9d1;
		font-size: 12px;
		cursor: pointer;
	}
	.filter-toggle input {
		accent-color: #25c6d1;
	}
	.filter-types {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2px 8px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid #17313e;
	}
	.filter-actions {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.filter-actions button {
		border: 1px solid #28546a;
		border-radius: 5px;
		background: #0d1b26;
		color: #b6c9d1;
		font-size: 10px;
		line-height: 26px;
		cursor: pointer;
	}
	.filter-actions button:hover {
		border-color: #25c6d1;
		color: #eafcfd;
	}
	@media (max-width: 1000px) {
		.global-tree {
			right: 0;
		}
		.sidebar-toggle {
			position: absolute;
			z-index: 4;
			top: 22px;
			right: 22px;
			display: block;
			height: 30px;
			padding: 0 12px;
			border: 1px solid #28546a;
			border-radius: 6px;
			background: rgb(5 10 16 / 88%);
			color: #dce7ec;
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
			border: 1px solid #28546a;
			border-radius: 5px;
			background: #0d1b26;
			color: #dce7ec;
			font-size: 15px;
			cursor: pointer;
		}
	}
</style>
