import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { HistoricalTime } from "../src/domain/historical_time.ts";
import { formatHistoricalYear, historicalDay } from "../src/domain/historical_calendar.ts";
import type { OutlineItem, OutlineLink, OutlineSnapshot } from "../src/domain/models.ts";
import { historicalTimelineTicks } from "../src/ui/historical_timeline_axis.ts";
import {
	historicalTimelineDomain,
	layoutHistoricalTimeline,
} from "../src/ui/historical_timeline_layout.ts";

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

Deno.test("historical timeline lays out ranges, unknown endpoints, collisions, and edges", () => {
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
		snapshot([dated, periodItem, unknownStart, unknownBoth, other], [
			link("dated", "other"),
			link("dated", "unknown-both"),
		]),
		(day) => day,
		0,
		100_000,
	);

	assertEquals(result.undated.map((entry) => entry.id), ["unknown-both"]);
	const byId = new Map(result.nodes.map((node) => [node.item.id, node]));
	const periodNode = byId.get("period")!;
	const unknownNode = byId.get("unknown-start")!;
	assert(periodNode.start < periodNode.end);
	assert(periodNode.startLatest < periodNode.endEarliest);
	assertEquals(unknownNode.unknownStart, true);
	assertEquals(unknownNode.start, 0);
	assertEquals(unknownNode.anchor, unknownNode.end);
	assertNotEquals(byId.get("dated")?.y, byId.get("period")?.y);
	assertEquals(result.edges.map((edge) => edge.id), ["dated-other"]);
	assertEquals(result.edges[0]?.source.item.id, "dated");
	assertEquals(result.edges[0]?.target.item.id, "other");
});

Deno.test("historical timeline ticks use month/day scales and never display year zero", () => {
	const yearDomain: [number, number] = [historicalDay(1604), historicalDay(1867)];
	const yearTicks = historicalTimelineTicks(yearDomain, 8);
	assert(yearTicks.length > 0);
	assert(yearTicks.every((tick) => tick.label.endsWith("年")));

	const monthDomain: [number, number] = [historicalDay(1604, 1), historicalDay(1605, 1)];
	const monthTicks = historicalTimelineTicks(monthDomain, 8);
	assert(monthTicks.some((tick) => tick.label.endsWith("1月")));
	const offsetMonthTicks = historicalTimelineTicks(
		[historicalDay(1604, 6, 15), historicalDay(1605, 6, 15)],
		8,
	);
	assertEquals(offsetMonthTicks[0]?.label, "1604年7月");

	const dayDomain: [number, number] = [historicalDay(1604, 1, 1), historicalDay(1604, 1, 5)];
	const dayTicks = historicalTimelineTicks(dayDomain, 5);
	assert(dayTicks.some((tick) => tick.label.endsWith("1月1日")));

	const bceDomain: [number, number] = [historicalDay(-2), historicalDay(1)];
	const bceTicks = historicalTimelineTicks(bceDomain, 10);
	assert(bceTicks.some((tick) => tick.label.startsWith(formatHistoricalYear(-1))));
	assert(bceTicks.some((tick) => tick.label.startsWith(formatHistoricalYear(1))));
	assert(bceTicks.every((tick) => !tick.label.includes("0年")));
});

Deno.test("all unset historical values use the outside-axis domain", () => {
	const items = [item("one"), item("two", { kind: "period", start: null, end: null })];
	assertEquals(historicalTimelineDomain(items), [historicalDay(1), historicalDay(2)]);
	const result = layoutHistoricalTimeline(snapshot(items), () => 0, 0, 100);
	assertEquals(result.nodes, []);
	assertEquals(result.undated.map((entry) => entry.id), ["one", "two"]);
});
