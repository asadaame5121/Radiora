<script lang="ts">
import type { TreeProjection } from "./tree_layout.ts";

let {
	projection,
	chronologyMode,
	historical,
	lodLabel,
	onProjectionChange,
	onChronologyModeChange,
	onZoomOut,
	onZoomIn,
	onFitView,
}: {
	projection: TreeProjection;
	chronologyMode: "created" | "historical";
	historical: boolean;
	lodLabel: string;
	onProjectionChange: (projection: TreeProjection) => void;
	onChronologyModeChange: (mode: "created" | "historical") => void;
	onZoomOut: () => void;
	onZoomIn: () => void;
	onFitView: () => void;
} = $props();

function selectProjection(next: TreeProjection): void {
	if (projection !== next) onProjectionChange(next);
}
</script>

<nav class="tree-projection" aria-label="Treeの投影方法">
	<button
		type="button"
		class:active={projection === "chronology"}
		aria-pressed={projection === "chronology"}
		onclick={() => selectProjection("chronology")}
	>Chronology</button>
	{#if projection === "chronology"}
		<button
			type="button"
			class:active={chronologyMode === "created"}
			aria-pressed={chronologyMode === "created"}
			onclick={() => onChronologyModeChange("created")}
		>作成日時</button>
		<button
			type="button"
			class:active={chronologyMode === "historical"}
			aria-pressed={chronologyMode === "historical"}
			onclick={() => onChronologyModeChange("historical")}
		>年表</button>
	{/if}
	<button
		type="button"
		class:active={projection === "lineage"}
		aria-pressed={projection === "lineage"}
		onclick={() => selectProjection("lineage")}
	>Lineage</button>
</nav>

<div class="tree-controls" style:visibility={historical ? "hidden" : "visible"}>
	<button type="button" aria-label="ズームアウト" title="ズームアウト"
		onclick={onZoomOut}>−</button>
	<button type="button" aria-label="ズームイン" title="ズームイン" onclick={onZoomIn}>＋</button>
	<button type="button" aria-label="全体を表示" title="全体を表示" onclick={onFitView}>⌗</button>
	<span><i></i>{lodLabel}</span>
</div>

<style>
.tree-controls {
	position: absolute;
	left: 22px;
	bottom: 22px;
	display: flex;
	align-items: center;
	gap: 8px;
}
.tree-projection {
	z-index: 1;
	position: absolute;
	top: 22px;
	right: 22px;
	display: flex;
	padding: 3px;
	border: 1px solid var(--border-bright);
	border-radius: 7px;
	background: var(--theme-lineage-overlay, rgb(5 10 16 / 88%));
	box-shadow: 0 8px 22px rgb(0 0 0 / 28%);
}
.tree-projection button {
	height: 30px;
	padding: 0 12px;
	border: 0;
	border-radius: 4px;
	background: transparent;
	color: var(--theme-muted, #7f949e);
	font: 11px var(--font-ui);
	letter-spacing: .03em;
	cursor: pointer;
}
.tree-projection button:hover {
	color: var(--text);
}
.tree-projection button.active {
	background: var(--theme-surface-raised, #12303d);
	color: var(--theme-text, #eafcfd);
	box-shadow: var(--control-active-shadow);
}
.tree-controls button,
.tree-controls span {
	height: 36px;
	border: 1px solid var(--border-bright);
	border-radius: 6px;
	background: var(--theme-lineage-overlay, rgb(5 10 16 / 88%));
	color: var(--text);
	box-shadow: 0 8px 22px rgb(0 0 0 / 28%);
}
.tree-controls button {
	width: 40px;
	font-size: 18px;
	cursor: pointer;
}
.tree-controls button:hover {
	border-color: var(--cyan);
	background: var(--theme-surface-hover, #0c1c27);
}
.tree-controls span {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-left: 10px;
	padding: 0 12px;
	color: var(--theme-muted, #b6c9d1);
	font-size: 11px;
}
.tree-controls i {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--cyan);
	box-shadow: 0 0 7px var(--cyan);
}
</style>
