<script lang="ts">
	import { Tabs } from "bits-ui";
	import type { LinkType, OutlineItem } from "../domain/models";
	import type { GlobalLineageProjection } from "../services/branch_service";
	import type { TreeBounds } from "./tree_camera";
	import type { TreeLayoutNode } from "./tree_layout";
	import { buildLaneOrder, labelForItem } from "./tree_layout";

	let {
		projection,
		inspectCluster,
		selectedId,
		onSelect,
		onOpen,
		onZoomToCluster,
	}: {
		projection: GlobalLineageProjection;
		inspectCluster: TreeLayoutNode | null;
		selectedId: string | null;
		onSelect: (id: string | null) => void;
		onOpen: (id: string) => void;
		onZoomToCluster: (bounds: TreeBounds | undefined) => void;
	} = $props();

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
			.filter((item): item is OutlineItem => item !== undefined)
			.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.id.localeCompare(b.id));
	});

	function internalLinks(itemId: string): Array<{ type: LinkType; targetLabel: string }> {
		if (!inspectCluster) return [];
		const memberIds = new Set(inspectCluster.itemIds);
		const workId = itemById.get(itemId)?.workId;
		const result: Array<{ type: LinkType; targetLabel: string }> = [];
		for (const link of projection.snapshot.links) {
			if (link.status === "retracted") continue;
			const fromItem = projection.snapshot.items.find((item) => item.workId === link.from.workId);
			const toItem = projection.snapshot.items.find((item) => item.workId === link.to.workId);
			if (!fromItem || !toItem) continue;
			if (link.from.workId !== workId && link.to.workId !== workId) continue;
			const targetId = link.from.workId === workId ? toItem.id : fromItem.id;
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

<Tabs.Content value="inspect" class="sidebar-pane">
	{#snippet child({ props })}
		<div {...props} class="sidebar-pane">
			{#if inspectCluster}
				<header class="pane-heading">
					<p class="eyebrow">クラスタの切り出し</p>
					<h2>{inspectCluster.count}件の思索</h2>
					<button type="button" onclick={() => onZoomToCluster(inspectCluster?.bounds)}>中央で拡大</button>
				</header>
				<ol class="cluster-members">
					{#each clusterMembers as member (member.id)}
						{@const internal = internalLinks(member.id)}
						{@const externalLinkTypes = externalStubs(member.id)}
						<li class:selected={member.id === selectedId}>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<!-- biome-ignore lint/a11y/useSemanticElements: The interactive row contains structured link metadata that is not valid button content. -->
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
								{#if internal.length > 0 || externalLinkTypes.length > 0}
									<fieldset class="member-links" aria-label="構成ノードの意味リンク">
										{#each internal as link (link.type + link.targetLabel)}
											<span class="link-chip type-{link.type.toLowerCase()}">{link.type} → {link.targetLabel}</span>
										{/each}
										{#each externalLinkTypes as type (type)}
											<span class="link-stub type-{type.toLowerCase()}">{type} → 外部</span>
										{/each}
									</fieldset>
								{/if}
							</div>
							<button class="open-member" type="button" onclick={() => onOpen(member.id)}>開く</button>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="pane-empty">クラスタを選ぶと、構成項目をここで確認できます。</p>
			{/if}
		</div>
	{/snippet}
</Tabs.Content>

<style>
	.sidebar-pane { min-width: 0; }
	.pane-heading h2 { margin: 3px 0 12px; color: #dce7ec; font-size: 13px; }
	.pane-heading button { margin-bottom: 10px; border: 1px solid #28546a; border-radius: 5px; background: #0d1b26; color: #b6c9d1; font-size: 10px; line-height: 26px; cursor: pointer; }
	.pane-heading button:hover { border-color: #25c6d1; color: #eafcfd; }
	.pane-empty { color: #657681; font-size: 11px; line-height: 1.6; }
	.cluster-members { margin: 0; padding: 0; list-style: none; }
	.cluster-members li { position: relative; margin-bottom: 8px; padding: 10px; border: 1px solid #17313e; border-radius: 7px; background: #07121a; cursor: pointer; outline: none; }
	.cluster-members li:hover, .cluster-members li:has(.member-main:hover), .cluster-members li:has(.member-main:focus), .cluster-members li.selected { border-color: #25c6d1; background: #0c1c27; }
	.cluster-members li.selected { box-shadow: inset 0 0 0 1px rgb(242 169 59 / 55%); }
	.member-label { margin: 0; color: #dce7ec; font-size: 12px; line-height: 1.5; }
	.member-links { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; padding: 0; border: 0; min-inline-size: 0; }
	.link-chip, .link-stub { padding: 2px 6px; border: 1px solid #28546a; border-radius: 4px; color: #9fb3bc; font-size: 9px; }
	.link-chip.type-from { border-color: #25c6d1; color: #73dce3; }
	.link-chip.type-like { border-color: #a855f7; color: #c9a1f2; }
	.link-chip.type-fix { border-color: #f2a93b; color: #f2c17e; }
	.link-chip.type-vs { border-color: #ef5b5b; color: #f2a0a0; }
	.link-stub { border-style: dashed; opacity: .7; }
	.open-member { margin-top: 8px; border: 1px solid #28546a; border-radius: 4px; background: #0d1b26; color: #b6c9d1; font-size: 10px; line-height: 24px; cursor: pointer; }
	.open-member:hover { border-color: #25c6d1; color: #eafcfd; }
</style>
