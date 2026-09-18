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

interface HistoricalTimelineBeltInput {
	start: number;
	end: number;
	anchor: number;
	startLatest: number;
	endEarliest: number;
	unknownStart: boolean;
	unknownEnd: boolean;
}

export function historicalTimelineBelt(input: HistoricalTimelineBeltInput) {
	if (input.unknownStart) {
		return {
			known: { start: input.endEarliest, end: input.anchor },
			unknown: { start: input.start, end: input.endEarliest, edge: "start" as const },
		};
	}
	if (input.unknownEnd) {
		return {
			known: { start: input.anchor, end: input.startLatest },
			unknown: { start: input.startLatest, end: input.end, edge: "end" as const },
		};
	}
	return { known: { start: input.start, end: input.end }, unknown: null };
}

function createTimelineNode(
	item: OutlineItem,
	time: HistoricalTime,
	project: (day: number) => number,
	left: number,
	right: number,
): HistoricalTimelineNode | null {
	const [start, end] = historicalTimeBounds(time);
	const anchorDay = start ?? end;
	if (anchorDay === null) return null;
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
	nodes.sort((a, b) => a.start - b.start || a.item.id.localeCompare(b.item.id));
	const laneEnds: number[] = [];
	for (const node of nodes) {
		let lane = laneEnds.findIndex((end) => end + ITEM_GAP < node.start);
		if (lane < 0) lane = laneEnds.length;
		laneEnds[lane] = Math.max(node.end, node.anchor + LABEL_WIDTH);
		node.y = TIMELINE_PADDING + lane * TIMELINE_LANE_HEIGHT;
	}
}

function buildEdges(
	links: OutlineSnapshot["links"],
	nodes: HistoricalTimelineNode[],
) {
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
		const node = time ? createTimelineNode(item, time, project, left, right) : null;
		if (node) nodes.push(node);
		else undated.push(item);
	}
	assignLanes(nodes);
	return { nodes, undated, edges: buildEdges(snapshot.links, nodes) };
}
