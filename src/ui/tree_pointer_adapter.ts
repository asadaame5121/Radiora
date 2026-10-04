import * as d3 from "d3";
import type { TreeCameraTransform, TreeViewport } from "./tree_camera.ts";

const MAX_ZOOM = 24;
const TRANSFORM_DURATION = 260;

export interface TreePointerPorts {
	onTransform: (transform: d3.ZoomTransform) => void;
	onResize: (viewport: TreeViewport) => void;
	onBackgroundClick: () => void;
}

/**
 * DOM boundary for D3's mouse/touch pan and wheel zoom. D3 performs SVG-local
 * coordinate conversion and captures active mouse gestures on the owning window;
 * the View owns the published camera, hover and dimensions.
 */
export function connectTreePointer(
	svg: SVGSVGElement,
	ports: TreePointerPorts,
	minZoom: number,
) {
	let disposed = false;
	let capturedWindow: Window | null = null;
	const selection = d3.select(svg);
	const zoom = d3.zoom<SVGSVGElement, unknown>()
		.scaleExtent([minZoom, MAX_ZOOM])
		.filter((event) => event.type !== "dblclick")
		.on("start.tree", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
			if (event.sourceEvent?.type === "mousedown") capturedWindow = svg.ownerDocument.defaultView;
		})
		.on("zoom.tree", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
			if (!disposed) ports.onTransform(event.transform);
		})
		.on("end.tree", () => {
			capturedWindow = null;
		});
	const observer = new ResizeObserver(([entry]) => {
		if (!disposed && entry) ports.onResize(entry.contentRect);
	});
	if (svg.parentElement) observer.observe(svg.parentElement);
	const click = (event: MouseEvent) => {
		const target = event.target;
		if (target instanceof Element && target.closest(".tree-node")) return;
		ports.onBackgroundClick();
		svg.focus({ preventScroll: true });
	};
	svg.addEventListener("click", click);
	selection.call(zoom).on("dblclick.zoom", null);
	return {
		setMinimumZoom: (next: number) => {
			zoom.scaleExtent([next, MAX_ZOOM]);
		},
		applyTransform: (next: TreeCameraTransform) => {
			if (disposed) return;
			selection.transition().duration(TRANSFORM_DURATION)
				.call(zoom.transform, d3.zoomIdentity.translate(next.x, next.y).scale(next.k));
		},
		dispose: () => {
			disposed = true;
			observer.disconnect();
			svg.removeEventListener("click", click);
			selection.interrupt().on(".zoom", null);
			zoom.on(".tree", null);
			if (capturedWindow) {
				d3.select(capturedWindow).on("mousemove.zoom", null).on("mouseup.zoom", null);
				d3.dragEnable(capturedWindow);
				capturedWindow = null;
			}
		},
	};
}
