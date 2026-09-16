<script lang="ts">
	import { onMount } from "svelte";
	import * as d3 from "d3";
	import type { OutlineSnapshot } from "../domain/models.ts";
	import { formatHistoricalTime } from "../domain/historical_time.ts";
	import { fitTreeBounds } from "./tree_camera.ts";
	import { historicalTimelineDomain, layoutHistoricalTimeline, TIMELINE_PADDING } from "./historical_timeline_layout.ts";
	import { historicalTimelineTicks } from "./historical_timeline_axis.ts";
	let { snapshot, selectedId, selectedWorkId, onSelect, onOpen, onContextMenu }: {
		snapshot: OutlineSnapshot; selectedId: string | null; selectedWorkId: string | null;
		onSelect: (id: string | null) => void; onOpen: (id: string) => void;
		onContextMenu: (id: string, event: MouseEvent | KeyboardEvent) => void;
	} = $props();
	let svg: SVGSVGElement;
	let width = $state(900);
	let height = $state(700);
	let camera = $state(d3.zoomIdentity);
	let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
	const scale = $derived(d3.scaleLinear().domain(historicalTimelineDomain(snapshot.items)).range([TIMELINE_PADDING, Math.max(TIMELINE_PADDING + 1, width - TIMELINE_PADDING)]));
	const screenScale = $derived(camera.rescaleX(scale));
	const layout = $derived(layoutHistoricalTimeline(snapshot, scale, 0, width));
	const ticks = $derived(historicalTimelineTicks(screenScale.domain() as [number, number], Math.max(2, width / 160)));
	const sx = (value: number) => camera.applyX(value);
	const sy = (value: number) => camera.applyY(value);
	const left = (node: typeof layout.nodes[number]) => node.unknownStart ? Math.min(0, sx(node.anchor)) : sx(node.start);
	const right = (node: typeof layout.nodes[number]) => node.unknownEnd ? Math.max(width, sx(node.anchor)) : sx(node.end);
	const title = (text: string) => text.split("\n")[0].slice(0, 28) || "無題";

	onMount(() => {
		const resize = new ResizeObserver(([entry]) => { if (entry) { width = entry.contentRect.width; height = entry.contentRect.height; } });
		resize.observe(svg);
		zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([.001, 1000000]).filter((event) => event.type !== "dblclick").on("zoom", (event) => camera = event.transform);
		d3.select(svg).call(zoom);
		return () => { resize.disconnect(); d3.select(svg).on(".zoom", null); };
	});

	function fit(): void {
		const nodes = layout.nodes;
		const bounds = nodes.reduce((bounds, node) => ({ minX: Math.min(bounds.minX, node.start), maxX: Math.max(bounds.maxX, node.end), minY: Math.min(bounds.minY, node.y), maxY: Math.max(bounds.maxY, node.y + 24) }), { minX: TIMELINE_PADDING, maxX: width - TIMELINE_PADDING, minY: TIMELINE_PADDING, maxY: TIMELINE_PADDING });
		const next = fitTreeBounds(bounds, { width, height }, { minZoom: .001, maxZoom: 1 });
		d3.select(svg).call(zoom.transform, d3.zoomIdentity.translate(next.x, next.y).scale(next.k));
	}
	function keydown(event: KeyboardEvent, id: string): void {
		if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); }
		if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); onContextMenu(id, event); }
	}
</script>

<div class="timeline">
	<!-- biome-ignore lint/a11y/useSemanticElements: SVG provides the graphical timeline coordinate system. -->
	<svg bind:this={svg} role="group" aria-label="歴史年表">
		<g aria-hidden="true" class="axis">
			{#each ticks as mark (mark.value)}<line x1={screenScale(mark.value)} x2={screenScale(mark.value)} y1="0" y2={height} /><text x={screenScale(mark.value)} y={height - 12} text-anchor="middle">{mark.label}</text>{/each}
		</g>
		<g class="edges" aria-hidden="true">{#each layout.edges as edge (edge.id)}<path d={`M ${sx(edge.source.anchor)} ${sy(edge.source.y)} L ${sx(edge.target.anchor)} ${sy(edge.target.y)}`}><title>{edge.type}</title></path>{/each}</g>
		{#each layout.nodes as node (node.item.id)}
			<!-- biome-ignore lint/a11y/useSemanticElements: SVG event marks support keyboard selection within the time axis. -->
			<g role="button" tabindex="0" aria-label={`${title(node.item.text)} ${formatHistoricalTime(node.time)}`} aria-pressed={selectedId === node.item.id || selectedWorkId === node.item.workId}
				class="event" class:selected={selectedId === node.item.id || selectedWorkId === node.item.workId}
				onclick={() => onSelect(node.item.id)} ondblclick={() => onOpen(node.item.id)} onkeydown={(event) => keydown(event, node.item.id)} oncontextmenu={(event) => onContextMenu(node.item.id, event)}>
				<title>{node.item.text}\n{formatHistoricalTime(node.time)}</title>
				<rect class="hit" x={left(node) - 6} y={sy(node.y) - 12 * camera.k} width={Math.max(12, right(node) - left(node) + 12)} height={36 * camera.k} />
				{#if node.time.kind === "point" && node.time.date.precision === "day"}
					<circle cx={sx(node.anchor)} cy={sy(node.y)} r={5 * camera.k} />
				{:else}
					<rect class="belt" class:uncertain={node.time.kind === "point" || node.unknownStart || node.unknownEnd} x={left(node)} y={sy(node.y) - 6 * camera.k} width={Math.max(2, right(node) - left(node))} height={12 * camera.k} />
					{#if node.time.kind === "period" && !node.unknownStart && !node.unknownEnd && node.startLatest < node.endEarliest}
						<rect class="certain" x={sx(node.startLatest)} y={sy(node.y) - 6 * camera.k} width={sx(node.endEarliest) - sx(node.startLatest)} height={12 * camera.k} />
					{/if}
				{/if}
				<text x={Math.max(4, sx(node.anchor))} y={sy(node.y) + 22 * camera.k} font-size={12 * camera.k}>{title(node.item.text)} · {formatHistoricalTime(node.time)}</text>
			</g>
		{/each}
	</svg>
	{#if layout.undated.length > 0}<details class="undated" open={layout.nodes.length === 0}><summary>年代未設定・両端不明 ({layout.undated.length})</summary>{#each layout.undated as item (item.id)}<button type="button" onclick={() => onSelect(item.id)} aria-pressed={selectedId === item.id || selectedWorkId === item.workId}>{title(item.text)}{item.historicalTime ? "（両端不明）" : ""}</button>{/each}</details>{/if}
	<div class="controls"><button type="button" aria-label="年表をズームアウト" onclick={() => d3.select(svg).call(zoom.scaleBy, .7)}>−</button><button type="button" aria-label="年表をズームイン" onclick={() => d3.select(svg).call(zoom.scaleBy, 1.4)}>＋</button><button type="button" onclick={fit}>全体を表示</button><span>実線: 期間 ／ 破線: 時点の幅・不明端点</span></div>
</div>

<style>
	.timeline { position: absolute; inset: 0; background: var(--theme-bg, #050a10); }
	svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
	.axis line { stroke: var(--border); stroke-dasharray: 3 5; } .axis text { fill: var(--muted); font-size: 11px; }
	.edges path { stroke: var(--cyan); opacity: .3; fill: none; }
	.event { cursor: pointer; fill: var(--cyan); } .event text { fill: var(--text); }
	.hit { fill: transparent; stroke: transparent; } .event.selected .hit, .event:focus .hit { stroke: var(--amber); }
	.belt { fill: var(--cyan); fill-opacity: .25; stroke: var(--cyan); } .certain { fill: var(--cyan); fill-opacity: .65; }
	.uncertain { stroke-dasharray: 4 3; fill-opacity: .1; }
	.controls { position: absolute; bottom: 30px; left: 15px; display: flex; gap: 8px; align-items: center; font-size: 10px; color: var(--muted); }
	button, .undated { background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 6px; }
	.undated { position: absolute; top: 64px; left: 15px; max-height: 35%; max-width: 280px; overflow: auto; font-size: 11px; }
	.undated button { display: block; width: 100%; text-align: left; margin-top: 4px; }
</style>
