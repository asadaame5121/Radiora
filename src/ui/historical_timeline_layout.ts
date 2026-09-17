import {
	historicalDateBounds,
	type HistoricalTime,
	historicalTimeBounds,
} from "../domain/historical_time.ts";
import { historicalDay } from "../domain/historical_calendar.ts";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";

export const TIMELINE_PADDING = 80;
export const TIMELINE_LANE_HEIGHT = 56;
const LABEL_WIDTH = 220;
const ITEM_GAP = 20;

export function historicalTimelineDomain(items: readonly OutlineItem[]): [number, number] {
	const values = items.flatMap((item) =>
		item.historicalTime
			? historicalTimeBounds(item.historicalTime).filter((value): value is number => value !== null)
			: []
	);
	if (values.length === 0) return [historicalDay(1), historicalDay(2)];
	let min = values[0];
	let max = values[0];
	for (const value of values) {
		min = Math.min(min, value);
		max = Math.max(max, value);
	}
	const padding = Math.max(1, (max - min) / 10);
	return [min - padding, max + padding];
}

export interface HistoricalTimelineNode {
	item: OutlineItem;
	time: HistoricalTime;
	start: number;
	end: number;
	anchor: number;
	startLatest: number;
	endEarliest: number;
	unknownStart: boolean;
	unknownEnd: boolean;
	y: number;
}

export interface HistoricalTimelineEdge {
	id: string;
	source: HistoricalTimelineNode;
	target: HistoricalTimelineNode;
	type: OutlineSnapshot["links"][number]["type"];
}

function createTimelineNode(
	item: OutlineItem,
	time: NonNullable<OutlineItem["historicalTime"]>,
	range: [number | null, number | null],
	project: (day: number) => number,
	bounds: [number, number],
): HistoricalTimelineNode {
	const [start, end] = range;
	const [left, right] = bounds;
	const anchorDay = start !== null ? start : (end !== null ? end : 0);
	const anchor = project(anchorDay);
	return {
		item,
		time,
		anchor,
		start: start === null ? Math.min(left, anchor) : project(start),
		end: end === null ? Math.max(right, anchor) : project(end),
		startLatest: time.kind === "period" && time.start
			? project(historicalDateBounds(time.start)[1])
			: anchor,
		endEarliest: time.kind === "period" && time.end
			? project(historicalDateBounds(time.end)[0])
			: anchor,
		unknownStart: start === null,
		unknownEnd: end === null,
		y: 0,
	};
}

function assignLanes(nodes: HistoricalTimelineNode[]): void {
	const laneEnds: number[] = [];
	for (const node of nodes) {
		let lane = laneEnds.findIndex((end) => end + ITEM_GAP < node.start);
		if (lane < 0) lane = laneEnds.length;
		laneEnds[lane] = Math.max(node.end, node.anchor + LABEL_WIDTH);
		node.y = TIMELINE_PADDING + lane * TIMELINE_LANE_HEIGHT;
	}
}

function buildTimelineEdges(
	links: readonly OutlineSnapshot["links"][number][],
	nodes: readonly HistoricalTimelineNode[],
): HistoricalTimelineEdge[] {
	const byWork = new Map(nodes.map((node) => [node.item.workId, node]));
	return links.flatMap((link) => {
		const source = byWork.get(link.fromId);
		const target = byWork.get(link.toId);
		return source && target ? [{ id: link.id, source, target, type: link.type }] : [];
	});
}

export function layoutHistoricalTimeline(
	snapshot: OutlineSnapshot,
	project: (day: number) => number,
	left: number,
	right: number,
) {
	const undated: OutlineItem[] = [];
	const nodes: HistoricalTimelineNode[] = [];
	for (const item of snapshot.items) {
		const time = item.historicalTime;
		const [start, end] = time ? historicalTimeBounds(time) : [null, null];
		if (!time || (start === null && end === null)) {
			undated.push(item);
			continue;
		}
		nodes.push(createTimelineNode(item, time, [start, end], project, [left, right]));
	}
	nodes.sort((a, b) => a.start - b.start || a.item.id.localeCompare(b.item.id));
	assignLanes(nodes);
	const edges = buildTimelineEdges(snapshot.links, nodes);
	return { nodes, edges, undated };
}
