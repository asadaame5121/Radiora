<script lang="ts">
	import { onMount } from "svelte";
	import * as d3 from "d3";
	import type { OutlineSnapshot } from "../domain/models";
	import {
		buildDirectNeighborSet,
		calculateLineageProjection,
		calculateTreeLayout,
		type TreeLayoutEdge,
		type TreeLayoutNode,
		type TreeProjection,
	} from "./tree_layout";
	import {
		loadTreeProjectionPreference,
		saveTreeProjectionPreference,
	} from "./tree_projection_preference";

	let {
		snapshot,
		selectedId = null,
		onSelect,
		onOpen,
		onContextMenu,
		onProjectionChange,
		onInspectCluster,
	}: {
		snapshot: OutlineSnapshot;
		selectedId?: string | null;
		onSelect: (id: string | null) => void;
		onOpen: (id: string) => void;
		onContextMenu: (id: string, event: MouseEvent | KeyboardEvent) => void;
		onProjectionChange?: (projection: TreeProjection) => void;
		onInspectCluster?: (cluster: TreeLayoutNode) => void;
	} = $props();

	let svgElement: SVGSVGElement;
	let width = $state(900);
	let height = $state(700);
	let transform = $state<d3.ZoomTransform>(d3.zoomIdentity);
	let hoveredId = $state<string | null>(null);
	let projection = $state<TreeProjection>("chronology");
	let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;

	const timeDomain = $derived.by((): [Date, Date] => {
		const timestamps = snapshot.items
			.map((item) => Date.parse(item.createdAt))
			.filter(Number.isFinite);
		if (timestamps.length === 0) {
			const now = Date.now();
			return [new Date(now - 86_400_000), new Date(now + 86_400_000)];
		}
		const min = Math.min(...timestamps);
		const max = Math.max(...timestamps);
		const span = Math.max(max - min, 86_400_000);
		const padding = span * .08;
		return [new Date(min - padding), new Date(max + padding)];
	});
	const chronologyBaseScale = $derived(
		d3.scaleTime().domain(timeDomain).range([70, Math.max(71, width - 70)]),
	);
	const chronologyScreenScale = $derived(transform.rescaleX(chronologyBaseScale));
	const lineageProjection = $derived.by(() => calculateLineageProjection(snapshot));
	const lineageDomainMax = $derived(
		lineageProjection.knotGeneration ?? lineageProjection.maxGeneration,
	);
	const lineageBaseScale = $derived(
		d3.scaleLinear()
			.domain(lineageDomainMax === 0 ? [-.5, .5] : [-.15, lineageDomainMax + .15])
			.range([70, Math.max(71, width - 70)]),
	);
	const layout = $derived.by(() => calculateTreeLayout(snapshot, {
		width,
		height,
		projection,
		projectX: (timestamp) => chronologyBaseScale(new Date(timestamp)),
		projectGeneration: (generation) => lineageBaseScale(generation),
		camera: { k: transform.k, x: transform.x, y: transform.y },
	}));
	const axisMarks = $derived.by(() => {
		if (projection === "chronology") {
			return chronologyScreenScale
				.ticks(Math.max(2, Math.floor(width / 180)))
				.map((tick) => ({
					key: tick.toISOString(),
					x: chronologyScreenScale(tick),
					label: formatTick(tick),
				}));
		}
		const count = lineageDomainMax + 1;
		const stride = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(width / 100))));
		const marks: Array<{ key: string; x: number; label: string }> = [];
		for (let generation = 0; generation <= lineageProjection.maxGeneration; generation += stride) {
			marks.push({
				key: `generation-${generation}`,
				x: transform.applyX(lineageBaseScale(generation)),
				label: `G${generation}`,
			});
		}
		if (lineageProjection.knotGeneration !== null) {
			marks.push({
				key: "lineage-knot",
				x: transform.applyX(lineageBaseScale(lineageProjection.knotGeneration)),
				label: "Knot",
			});
		}
		return marks;
	});
	const focusId = $derived(hoveredId ?? selectedId);
	const directNeighbors = $derived(
		focusId ? buildDirectNeighborSet(snapshot, focusId) : new Set<string>(),
	);
	const contextLabelIds = $derived.by(() => {
		const visible = new Set<string>();
		const accepted: Array<{ x1: number; x2: number; y1: number; y2: number }> = [];
		const candidates = [...layout.nodes].sort((a, b) => {
			const aEmphasized = a.itemIds.some((id) => directNeighbors.has(id)) ? 0 : 1;
			const bEmphasized = b.itemIds.some((id) => directNeighbors.has(id)) ? 0 : 1;
			return aEmphasized - bEmphasized || a.x - b.x;
		});
		for (const node of candidates) {
			const rect = {
				x1: node.x + node.radius + 8,
				x2: node.x + node.radius + 12 + node.labelWidth,
				y1: node.y - 10,
				y2: node.y + 10 + Math.max(0, node.labelLines.length - 1) * 14,
			};
			if (rect.x1 < 4 || rect.x2 > width - 8 || rect.y1 < 4 || rect.y2 > height - 44) continue;
			const hitsNode = layout.nodes.some((other) => {
				if (other.id === node.id) return false;
				const padding = other.radius + 6;
				return rectanglesOverlap(rect, {
					x1: other.x - padding,
					x2: other.x + padding,
					y1: other.y - padding,
					y2: other.y + padding,
				});
			});
			if (hitsNode || accepted.some((other) => rectanglesOverlap(rect, other))) continue;
			visible.add(node.id);
			accepted.push(rect);
		}
		return visible;
	});
	const minZoom = $derived(Math.min(1, fitCamera().k));

	onMount(() => {
		projection = loadTreeProjectionPreference();
		const resizeObserver = new ResizeObserver(([entry]) => {
			if (!entry) return;
			width = entry.contentRect.width;
			height = entry.contentRect.height;
		});
		if (svgElement.parentElement) resizeObserver.observe(svgElement.parentElement);
		svgElement.addEventListener("click", handleCanvasClick);

		zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
			.scaleExtent([minZoom, 24])
			.filter((event) => event.type !== "dblclick")
			.on("zoom", (event) => {
				transform = event.transform;
			});
		d3.select(svgElement).call(zoomBehavior).on("dblclick.zoom", null);

		return () => {
			resizeObserver.disconnect();
			svgElement.removeEventListener("click", handleCanvasClick);
		};
	});

	$effect(() => {
		if (!zoomBehavior) return;
		// The minimum zoom must reach the whole-content fit view, so it follows
		// the content bounds dynamically. d3 clamps gestures to this range.
		zoomBehavior.scaleExtent([minZoom, 24]);
	});

	function edgePath(edge: TreeLayoutEdge): string {
		const sourceY = edge.source.y;
		const targetY = edge.target.y;
		const dx = edge.target.x - edge.source.x;
		const dy = targetY - sourceY;
		const distance = Math.max(1, Math.hypot(dx, dy));
		const ux = dx / distance;
		const uy = dy / distance;
		const sourceClearance = edge.source.radius + 6;
		const targetClearance = edge.target.radius + 6;
		const sx = edge.source.x + ux * sourceClearance;
		const sy = sourceY + uy * sourceClearance;
		const tx = edge.target.x - ux * targetClearance;
		const ty = targetY - uy * targetClearance;
		const midpoint = (sx + tx) / 2;
		return `M ${sx} ${sy} C ${midpoint} ${sy}, ${midpoint} ${ty}, ${tx} ${ty}`;
	}

	function edgeClass(edge: TreeLayoutEdge): string {
		return `tree-edge type-${edge.type.toLowerCase()}`;
	}

	function nodeIsEmphasized(node: TreeLayoutNode): boolean {
		if (!focusId) return true;
		return node.itemIds.some((id) => directNeighbors.has(id));
	}

	function edgeIsEmphasized(edge: TreeLayoutEdge): boolean {
		if (!focusId) return false;
		const sourceFocused = edge.source.itemIds.includes(focusId);
		const targetFocused = edge.target.itemIds.includes(focusId);
		return sourceFocused || targetFocused;
	}

	function edgeIsVisible(edge: TreeLayoutEdge): boolean {
		if (!edgeIsInViewport(edge)) {
			return Boolean(focusId) && edgeIsEmphasized(edge);
		}
		if (layout.lod === "detail") return true;
		if (layout.lod === "overview") return edge.type === "FROM";
		if (Math.abs(edge.target.x - edge.source.x) > width * .48 && !edgeIsEmphasized(edge)) {
			return false;
		}
		return edge.type === "FROM" || edgeIsEmphasized(edge);
	}

	function edgeIsInViewport(edge: TreeLayoutEdge): boolean {
		const padding = 120;
		const sourceY = edge.source.y;
		const targetY = edge.target.y;
		return edge.source.x >= -padding
			&& edge.source.x <= width + padding
			&& edge.target.x >= -padding
			&& edge.target.x <= width + padding
			&& sourceY >= -padding
			&& sourceY <= height + padding
			&& targetY >= -padding
			&& targetY <= height + padding;
	}

	function showLabel(node: TreeLayoutNode): boolean {
		if (node.aggregate) return true;
		if (layout.lod === "detail") return true;
		if (layout.lod === "overview") return false;
		return contextLabelIds.has(node.id);
	}

	function handleNodeClick(node: TreeLayoutNode): void {
		if (node.aggregate) {
			// Inspecting a cluster must not move the central camera.
			onInspectCluster?.(node);
			return;
		}
		onSelect(node.id);
	}

	function handleCanvasClick(event: MouseEvent): void {
		const target = event.target;
		if (target instanceof Element && target.closest(".tree-node")) return;
		hoveredId = null;
		onSelect(null);
		svgElement.focus({ preventScroll: true });
	}

	function handleNodeDoubleClick(event: MouseEvent, node: TreeLayoutNode): void {
		event.stopPropagation();
		if (node.aggregate) return;
		onOpen(node.id);
	}

	function handleNodeKeydown(event: KeyboardEvent, node: TreeLayoutNode): void {
		if (!node.aggregate && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
			event.preventDefault();
			onContextMenu(node.id, event);
			return;
		}
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		handleNodeClick(node);
	}

	function zoomBy(factor: number): void {
		const nextK = Math.max(minZoom, Math.min(24, transform.k * factor));
		applyTransform(d3.zoomIdentity
			.translate(width / 2 - (width / 2 - transform.x) / transform.k * nextK, transform.y)
			.scale(nextK));
	}

	function fitView(): void {
		const fit = fitCamera();
		applyTransform(d3.zoomIdentity
			.translate(fit.x, fit.y)
			.scale(fit.k));
	}

	/** Zooms the camera so the given world-space bounds fill the viewport. */
	export function zoomToBounds(bounds: {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}): void {
		const fit = fitTransformFor(bounds);
		applyTransform(d3.zoomIdentity
			.translate(fit.x, fit.y)
			.scale(fit.k));
	}

	function fitCamera(): { k: number; x: number; y: number } {
		if (layout.nodes.length === 0) {
			return { k: 1, x: 0, y: 0 };
		}
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const node of layout.nodes) {
			const bounds = node.aggregate && node.bounds
				? node.bounds
				: {
					minX: node.worldX,
					minY: node.worldY,
					maxX: node.worldX,
					maxY: node.worldY,
				};
			minX = Math.min(minX, bounds.minX);
			minY = Math.min(minY, bounds.minY);
			maxX = Math.max(maxX, bounds.maxX);
			maxY = Math.max(maxY, bounds.maxY);
		}
		return fitTransformFor({ minX, minY, maxX, maxY });
	}

	function fitTransformFor(bounds: {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}): { k: number; x: number; y: number } {
		const padding = 60;
		const spanX = Math.max(1, bounds.maxX - bounds.minX);
		const spanY = Math.max(1, bounds.maxY - bounds.minY);
		const k = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
		const clamped = Math.max(.05, Math.min(24, k));
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;
		return {
			k: clamped,
			x: width / 2 - centerX * clamped,
			y: height / 2 - centerY * clamped,
		};
	}

	function selectProjection(next: TreeProjection): void {
		if (projection === next) return;
		projection = next;
		saveTreeProjectionPreference(next);
		onProjectionChange?.(next);
		fitView();
	}

	function applyTransform(next: d3.ZoomTransform): void {
		if (!zoomBehavior) {
			transform = next;
			return;
		}
		d3.select(svgElement)
			.transition()
			.duration(260)
			.call(zoomBehavior.transform, next);
	}

	function formatTick(tick: Date): string {
		const span = chronologyScreenScale.domain()[1].getTime() -
			chronologyScreenScale.domain()[0].getTime();
		if (span > 1_000 * 60 * 60 * 24 * 730) return d3.timeFormat("%Y")(tick);
		if (span > 1_000 * 60 * 60 * 24 * 60) return d3.timeFormat("%Y.%m")(tick);
		return d3.timeFormat("%m/%d")(tick);
	}

	function nodeTitle(node: TreeLayoutNode): string {
		if (node.aggregate) return `${node.count}件の思索。クリックで右側に表示`;
		const parsed = new Date(node.item.createdAt);
		const createdAt = Number.isFinite(parsed.getTime())
			? new Intl.DateTimeFormat("ja-JP", {
				dateStyle: "medium",
				timeStyle: "short",
			}).format(parsed)
			: node.item.createdAt;
		const knot = node.isLineageKnot ? "\nFROM循環を検出：Knot帯へ退避" : "";
		return `${node.item.text}\n作成: ${createdAt}${knot}`;
	}

	function rectanglesOverlap(
		a: { x1: number; x2: number; y1: number; y2: number },
		b: { x1: number; x2: number; y1: number; y2: number },
	): boolean {
		return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
	}
</script>

<div class="tree-root">
	{#if snapshot.items.length === 0}
		<div class="tree-empty">
			<span></span>
			<p>最初の思索を作ると、ここに系統が現れます。</p>
		</div>
	{/if}

	<svg
		bind:this={svgElement}
		role="group"
		aria-label="思索の系統樹"
		tabindex="-1"
	>
		<g class="time-grid" aria-hidden="true">
			{#each axisMarks as mark (mark.key)}
				<line
					class:knot-mark={mark.key === "lineage-knot"}
					x1={mark.x}
					x2={mark.x}
					y1="0"
					y2={height}
				/>
				<text x={mark.x} y={height - 22} text-anchor="middle">{mark.label}</text>
			{/each}
		</g>

		<g class="tree-edges">
			{#each layout.edges.filter(edgeIsVisible) as edge (edge.id)}
				<path
					d={edgePath(edge)}
					class={edgeClass(edge)}
					class:dimmed={Boolean(focusId) && !edgeIsEmphasized(edge)}
					class:emphasized={Boolean(focusId) && edgeIsEmphasized(edge)}
					style:stroke-width={Math.min(4, 1.2 + Math.log2(edge.count))}
				/>
			{/each}
		</g>

		<g class="tree-nodes">
			{#each layout.nodes as node (node.id)}
				{#if node.x >= -200 && node.x <= width + 200 && node.y >= -80 && node.y <= height + 80}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g
						class="tree-node"
						class:dimmed={Boolean(focusId) && !nodeIsEmphasized(node)}
						class:emphasized={Boolean(focusId) && nodeIsEmphasized(node)}
						class:selected={node.itemIds.includes(selectedId ?? "")}
						class:aggregate={node.aggregate}
						class:knot={node.isKnot}
						transform={`translate(${node.x} ${node.y})`}
						role="button"
						tabindex="0"
						aria-label={node.aggregate ? `${node.count}件の思索` : node.label}
						onmouseenter={() => (hoveredId = node.aggregate ? null : node.id)}
						onmouseleave={() => (hoveredId = null)}
						onfocus={() => (hoveredId = node.aggregate ? null : node.id)}
						onblur={() => (hoveredId = null)}
						onclick={() => handleNodeClick(node)}
						ondblclick={(event) => handleNodeDoubleClick(event, node)}
						oncontextmenu={(event) => {
							if (node.aggregate) return;
							event.preventDefault();
							onContextMenu(node.id, event);
						}}
						onkeydown={(event) => handleNodeKeydown(event, node)}
					>
						<title>{nodeTitle(node)}</title>
						<circle class="node-safety" r={node.radius + 5} />
						{#if node.isKnot}
							<circle class="node-knot-outer" r={node.radius + 2} />
							<circle class="node-knot-inner" r={node.radius - 2} />
						{:else if node.aggregate}
							<circle class="node-cluster" r={node.radius} />
							<text class="cluster-count" text-anchor="middle" dy=".34em">{node.count}</text>
						{:else}
							<circle class="node-core" r={node.radius} />
							<circle class="node-selection" r={node.radius + 5} />
						{/if}

						{#if showLabel(node) && !node.aggregate}
							<text class="node-label" x={node.radius + 12} dy=".32em">
								{#each node.labelLines as line, index}
									<tspan x={node.radius + 12} dy={index === 0 ? 0 : "1.15em"}>{line}</tspan>
								{/each}
							</text>
						{/if}
					</g>
				{/if}
			{/each}
		</g>
	</svg>

	<div class="tree-projection" aria-label="Treeの投影方法">
		<button
			class:active={projection === "chronology"}
			aria-pressed={projection === "chronology"}
			onclick={() => selectProjection("chronology")}
		>Chronology</button>
		<button
			class:active={projection === "lineage"}
			aria-pressed={projection === "lineage"}
			onclick={() => selectProjection("lineage")}
		>Lineage</button>
	</div>

	<div class="tree-controls">
		<button aria-label="ズームアウト" title="ズームアウト" onclick={() => zoomBy(.7)}>−</button>
		<button aria-label="ズームイン" title="ズームイン" onclick={() => zoomBy(1.4)}>＋</button>
		<button aria-label="全体を表示" title="全体を表示" onclick={fitView}>⌗</button>
		<span><i></i>{layout.lod === "detail" ? "Detail" : layout.lod === "context" ? "Context" : "Overview"}</span>
	</div>
</div>

<style>
	.tree-root {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background:
			radial-gradient(circle at 50% 45%, rgb(37 198 209 / 5%), transparent 44%),
			#050a10;
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
		cursor: grab;
		touch-action: none;
	}
	svg:active {
		cursor: grabbing;
	}
	.time-grid line {
		stroke: #17313e;
		stroke-width: 1;
		stroke-dasharray: 3 5;
		opacity: .65;
	}
	.time-grid text {
		fill: #657681;
		font: 11px Inter, "Noto Sans JP", sans-serif;
		letter-spacing: .08em;
	}
	.time-grid .knot-mark {
		stroke: #ef5b5b;
	}
	.tree-edge {
		fill: none;
		stroke: #25c6d1;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: .42;
		transition: opacity .14s ease, filter .14s ease;
	}
	.tree-edge.type-like {
		stroke: #a855f7;
	}
	.tree-edge.type-fix {
		stroke: #f2a93b;
	}
	.tree-edge.type-vs {
		stroke: #ef5b5b;
	}
	.tree-edge.type-in {
		stroke: #92a2ad;
		stroke-dasharray: 5 5;
	}
	.tree-edge.dimmed {
		opacity: .07;
	}
	.tree-edge.emphasized {
		opacity: .96;
		filter: drop-shadow(0 0 4px currentColor);
	}
	.tree-node {
		cursor: pointer;
		outline: none;
		transition: opacity .14s ease;
	}
	.tree-node.dimmed {
		opacity: .16;
	}
	.node-safety {
		fill: #050a10;
		stroke: none;
	}
	.node-core {
		fill: #25c6d1;
		filter: drop-shadow(0 0 5px rgb(37 198 209 / 78%));
	}
	.node-selection {
		fill: none;
		stroke: transparent;
		stroke-width: 2;
	}
	.tree-node:hover .node-core,
	.tree-node:focus .node-core,
	.tree-node.emphasized .node-core {
		fill: #eafcfd;
		filter: drop-shadow(0 0 7px #25c6d1);
	}
	.tree-node.selected .node-selection {
		stroke: #f2a93b;
		filter: drop-shadow(0 0 6px rgb(242 169 59 / 65%));
	}
	.node-knot-outer,
	.node-knot-inner {
		fill: #050a10;
		stroke: #ef5b5b;
		stroke-width: 2;
		filter: drop-shadow(0 0 5px rgb(239 91 91 / 45%));
	}
	.node-knot-inner {
		fill: rgb(239 91 91 / 28%);
		stroke-width: 1;
	}
	.node-cluster {
		fill: #07121a;
		stroke: #25c6d1;
		stroke-width: 2;
		filter: drop-shadow(0 0 6px rgb(37 198 209 / 55%));
	}
	.cluster-count {
		fill: #eafcfd;
		font: 10px Inter, sans-serif;
		pointer-events: none;
	}
	.node-label {
		fill: #dce7ec;
		stroke: #050a10;
		stroke-width: 6px;
		paint-order: stroke fill;
		font: 12px Georgia, "Noto Serif JP", serif;
		letter-spacing: .02em;
		pointer-events: none;
	}
	.tree-controls {
		position: absolute;
		left: 22px;
		bottom: 22px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.tree-projection {
		position: absolute;
		top: 22px;
		right: 22px;
		display: flex;
		padding: 3px;
		border: 1px solid #28546a;
		border-radius: 7px;
		background: rgb(5 10 16 / 88%);
		box-shadow: 0 8px 22px rgb(0 0 0 / 28%);
	}
	.tree-projection button {
		height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: #7f949e;
		font: 11px Inter, "Noto Sans JP", sans-serif;
		letter-spacing: .03em;
		cursor: pointer;
	}
	.tree-projection button:hover {
		color: #dce7ec;
	}
	.tree-projection button.active {
		background: #12303d;
		color: #eafcfd;
		box-shadow: inset 0 0 0 1px rgb(37 198 209 / 42%);
	}
	.tree-controls button,
	.tree-controls span {
		height: 36px;
		border: 1px solid #28546a;
		border-radius: 6px;
		background: rgb(5 10 16 / 88%);
		color: #dce7ec;
		box-shadow: 0 8px 22px rgb(0 0 0 / 28%);
	}
	.tree-controls button {
		width: 40px;
		font-size: 18px;
		cursor: pointer;
	}
	.tree-controls button:hover {
		border-color: #25c6d1;
		background: #0c1c27;
	}
	.tree-controls span {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: 10px;
		padding: 0 12px;
		color: #b6c9d1;
		font-size: 11px;
	}
	.tree-controls i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #25c6d1;
		box-shadow: 0 0 7px #25c6d1;
	}
	.tree-empty {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-content: center;
		justify-items: center;
		color: #657681;
		font-size: 12px;
		pointer-events: none;
	}
	.tree-empty span {
		width: 12px;
		height: 12px;
		border: 2px solid #25c6d1;
		border-radius: 50%;
		box-shadow: 0 0 16px #25c6d1;
	}
</style>
