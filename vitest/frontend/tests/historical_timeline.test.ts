import { expect, test } from "vitest";
import type { HistoricalTime } from "../../../src/domain/historical_time.ts";
import {
	formatHistoricalYear,
	historicalDay,
	MAX_HISTORICAL_YEAR,
} from "../../../src/domain/historical_calendar.ts";
import type { OutlineItem, OutlineLink, OutlineSnapshot } from "../../../src/domain/models.ts";
import { historicalTimelineTicks } from "../../../src/ui/historical_timeline_axis.ts";
import {
	historicalTimelineBelt,
	historicalTimelineDomain,
	layoutHistoricalTimeline,
} from "../../../src/ui/historical_timeline_layout.ts";

const DATE = "2026-09-01T00:00:00.000Z";

function item(id: string, historicalTime?: HistoricalTime): OutlineItem {
	return {
		id,
		workId: `work-${id}`,
		text: id,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: DATE,
		updatedAt: DATE,
		...(historicalTime ? { historicalTime } : {}),
	};
}

function link(fromId: string, toId: string): OutlineLink {
	return {
		id: `${fromId}-${toId}`,
		fromId: `work-${fromId}`,
		toId: `work-${toId}`,
		from: { scope: "work", workId: `work-${fromId}` },
		to: { scope: "work", workId: `work-${toId}` },
		type: "FROM",
		status: "asserted",
		origin: "human",
		createdAt: DATE,
	};
}

function snapshot(items: OutlineItem[], links: OutlineLink[] = []): OutlineSnapshot {
	return { items, links, knots: [], stashItemIds: [] };
}

const pointYear = (year: number, approximate = false): HistoricalTime => ({
	kind: "point",
	date: { precision: "year", year, approximate },
});

test("historical timeline separates a known endpoint range from its unknown extension", () => {
	expect(
		historicalTimelineBelt({
			start: 0,
			end: 80,
			anchor: 80,
			startLatest: 80,
			endEarliest: 60,
			unknownStart: true,
			unknownEnd: false,
		}),
	).toEqual({
		known: { start: 60, end: 80 },
		unknown: { start: 0, end: 60, edge: "start" },
	});
	expect(
		historicalTimelineBelt({
			start: 20,
			end: 100,
			anchor: 20,
			startLatest: 40,
			endEarliest: 20,
			unknownStart: false,
			unknownEnd: true,
		}),
	).toEqual({
		known: { start: 20, end: 40 },
		unknown: { start: 40, end: 100, edge: "end" },
	});
});

test("historical timeline lays out ranges, unknown endpoints, collisions, and edges", () => {
	const dated = item("dated", pointYear(1604));
	const periodItem = item("period", {
		kind: "period",
		start: { precision: "year", year: 1604, approximate: false },
		end: { precision: "year", year: 1867, approximate: true },
		original: "江戸",
	});
	const unknownStart = item("unknown-start", {
		kind: "period",
		start: null,
		end: { precision: "year", year: 1867, approximate: false },
	});
	const unknownBoth = item("unknown-both", { kind: "period", start: null, end: null });
	const other = item("other", pointYear(1867));
	const result = layoutHistoricalTimeline(
		snapshot(
			[dated, periodItem, unknownStart, unknownBoth, other],
			[link("dated", "other"), link("dated", "unknown-both")],
		),
		(day) => day,
		0,
		100_000,
	);

	expect(result.undated.map((entry) => entry.id)).toEqual(["unknown-both"]);
	const byId = new Map(result.nodes.map((node) => [node.item.id, node]));
	const periodNode = byId.get("period");
	const unknownNode = byId.get("unknown-start");
	if (!periodNode || !unknownNode) throw new Error("expected period and unknown-start nodes");
	expect(periodNode.start < periodNode.end).toBeTruthy();
	expect(periodNode.startLatest < periodNode.endEarliest).toBeTruthy();
	expect(unknownNode.unknownStart).toEqual(true);
	expect(unknownNode.start).toEqual(0);
	expect(unknownNode.anchor).toEqual(unknownNode.end);
	expect(byId.get("dated")?.y).not.toEqual(byId.get("period")?.y);
	expect(result.edges.map((edge) => edge.id)).toEqual(["dated-other"]);
	expect(result.edges[0]?.source.item.id).toEqual("dated");
	expect(result.edges[0]?.target.item.id).toEqual("other");
});

test("historical timeline ticks use month/day scales and never display year zero", () => {
	const yearDomain: [number, number] = [historicalDay(1604), historicalDay(1867)];
	const yearTicks = historicalTimelineTicks(yearDomain, 8);
	expect(yearTicks.length > 0).toBeTruthy();
	expect(yearTicks.every((tick) => tick.label.endsWith("年"))).toBeTruthy();

	const monthDomain: [number, number] = [historicalDay(1604, 1), historicalDay(1605, 1)];
	const monthTicks = historicalTimelineTicks(monthDomain, 8);
	expect(monthTicks.some((tick) => tick.label.endsWith("1月"))).toBeTruthy();
	const offsetMonthTicks = historicalTimelineTicks(
		[historicalDay(1604, 6, 15), historicalDay(1605, 6, 15)],
		8,
	);
	expect(offsetMonthTicks[0]?.label).toEqual("1604年7月");

	const dayDomain: [number, number] = [historicalDay(1604, 1, 1), historicalDay(1604, 1, 5)];
	const dayTicks = historicalTimelineTicks(dayDomain, 5);
	expect(dayTicks.some((tick) => tick.label.endsWith("1月1日"))).toBeTruthy();

	const bceDomain: [number, number] = [historicalDay(-2), historicalDay(1)];
	const bceTicks = historicalTimelineTicks(bceDomain, 10);
	expect(bceTicks.some((tick) => tick.label.startsWith(formatHistoricalYear(-1)))).toBeTruthy();
	expect(bceTicks.some((tick) => tick.label.startsWith(formatHistoricalYear(1)))).toBeTruthy();
	expect(bceTicks.every((tick) => !tick.label.includes("0年"))).toBeTruthy();
});

test("historical timeline ticks stay inside the supported calendar range", () => {
	const firstDay = historicalDay(-MAX_HISTORICAL_YEAR);
	const endExclusive = historicalDay(MAX_HISTORICAL_YEAR + 1);
	const inRange = (ticks: Array<{ value: number }>) =>
		ticks.every((tick) => tick.value >= firstDay && tick.value < endExclusive);

	const lowerBoundary = historicalTimelineTicks([firstDay - 1, firstDay + 1], 8);
	expect(inRange(lowerBoundary)).toBeTruthy();
	expect(lowerBoundary.some((tick) => tick.value === firstDay)).toBeTruthy();

	const upperBoundary = historicalTimelineTicks([endExclusive - 1, endExclusive + 1], 8);
	expect(inRange(upperBoundary)).toBeTruthy();
	expect(upperBoundary.some((tick) => tick.value === endExclusive - 1)).toBeTruthy();

	expect(historicalTimelineTicks([firstDay - 2, firstDay - 1], 8)).toEqual([]);
	expect(historicalTimelineTicks([endExclusive, endExclusive + 2], 8)).toEqual([]);

	const lastDay = historicalTimelineTicks([endExclusive - 1, endExclusive], 8);
	expect(lastDay.map((tick) => tick.value)).toEqual([endExclusive - 1]);

	const lowerMonthBoundary = historicalTimelineTicks(
		[firstDay, historicalDay(-MAX_HISTORICAL_YEAR + 1)],
		8,
	);
	const upperMonthBoundary = historicalTimelineTicks(
		[historicalDay(MAX_HISTORICAL_YEAR, 12), historicalDay(MAX_HISTORICAL_YEAR + 2)],
		8,
	);
	expect(inRange(lowerMonthBoundary)).toBeTruthy();
	expect(inRange(upperMonthBoundary)).toBeTruthy();
});

test("all unset historical values use the outside-axis domain", () => {
	const items = [item("one"), item("two", { kind: "period", start: null, end: null })];
	expect(historicalTimelineDomain(items)).toEqual([historicalDay(1), historicalDay(2)]);
	const result = layoutHistoricalTimeline(snapshot(items), () => 0, 0, 100);
	expect(result.nodes).toEqual([]);
	expect(result.undated.map((entry) => entry.id)).toEqual(["one", "two"]);
});
