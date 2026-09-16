import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import * as v from "valibot";
import {
	formatHistoricalYear,
	historicalDateFromDay,
	historicalDay,
} from "../src/domain/historical_calendar.ts";
import {
	formatHistoricalTime,
	historicalDateBounds,
	HistoricalDateSchema,
	historicalTimeBounds,
	HistoricalTimeSchema,
} from "../src/domain/historical_time.ts";

Deno.test("historical calendar crosses BCE without a display year zero and round-trips days", () => {
	assertEquals([-1, 0, 1].map(formatHistoricalYear), ["紀元前2年", "紀元前1年", "1年"]);
	assertEquals(formatHistoricalYear(-43), "紀元前44年");
	for (const year of [-999999, -400, -43, -1, 0, 1, 99, 100, 400, 1604, 1867, 999999]) {
		for (const month of [1, 2, 3, 12]) {
			assertEquals(historicalDateFromDay(historicalDay(year, month, 15)), { year, month, day: 15 });
		}
		assertEquals(historicalDay(year + 1) - historicalDay(year, 12, 31), 1);
	}
	assertEquals(historicalDateFromDay(historicalDay(0, 12, 31) + 1), { year: 1, month: 1, day: 1 });
	for (const coordinate of [NaN, Infinity, historicalDay(-999999) - 1, historicalDay(1000000)]) {
		assertThrows(() => historicalDateFromDay(coordinate), RangeError);
	}
});

Deno.test("historical precision and circa preserve uncertainty without manufacturing tolerance", () => {
	const date = v.parse(HistoricalDateSchema, {
		precision: "century",
		era: "ce",
		century: 15,
		approximate: true,
	});
	assertEquals(historicalDateBounds(date), [historicalDay(1401), historicalDay(1501) - 1]);
	assertEquals(formatHistoricalTime({ kind: "point", date }), "15世紀頃");
	assertEquals(
		formatHistoricalTime({ kind: "point", date, original: "十五世紀頃" }),
		"十五世紀頃（15世紀頃）",
	);
	assertEquals(
		historicalDateBounds(
			v.parse(HistoricalDateSchema, { precision: "century", era: "bce", century: 1 }),
		),
		[historicalDay(-99), historicalDay(1) - 1],
	);
	assertEquals(
		historicalDateBounds(v.parse(HistoricalDateSchema, { precision: "month", year: 0, month: 2 })),
		[historicalDay(0, 2), historicalDay(0, 3) - 1],
	);
});

Deno.test("historical schemas reject invalid dates and reversed periods and accept unknown endpoints", () => {
	for (const year of [0, -400, 2000]) {
		assert(
			v.safeParse(HistoricalDateSchema, { precision: "day", year, month: 2, day: 29 }).success,
		);
	}
	for (
		const value of [
			{ precision: "day", year: 1900, month: 2, day: 29 },
			{ precision: "day", year: 1604, month: 4, day: 31 },
			{ precision: "year", year: Infinity },
			{ precision: "year", year: 1.5 },
			{ precision: "year", year: 1000000 },
			{ precision: "month", year: 1, month: 13 },
			{ precision: "century", era: "ce", century: 0 },
		]
	) assert(!v.safeParse(HistoricalDateSchema, value).success);
	const start = { precision: "year", year: 1604 };
	const end = { precision: "year", year: 1867 };
	const period = v.parse(HistoricalTimeSchema, { kind: "period", start, end });
	assertEquals(historicalTimeBounds(period), [historicalDay(1604), historicalDay(1868) - 1]);
	assert(!v.safeParse(HistoricalTimeSchema, { kind: "period", start: end, end: start }).success);
	for (const pair of [[start, null], [null, end], [null, null]]) {
		assert(
			v.safeParse(HistoricalTimeSchema, { kind: "period", start: pair[0], end: pair[1] }).success,
		);
	}
});

Deno.test("historical periods preserve unknown endpoints and allow overlapping precision", () => {
	const start = v.parse(HistoricalDateSchema, { precision: "day", year: -43, month: 3, day: 15 });
	assertEquals(start.approximate, false);
	assertEquals(formatHistoricalTime({ kind: "point", date: start }), "紀元前44年3月15日");
	assertEquals(historicalTimeBounds({ kind: "period", start, end: null }), [
		historicalDay(-43, 3, 15),
		null,
	]);
	assertEquals(historicalTimeBounds({ kind: "period", start: null, end: start }), [
		null,
		historicalDay(-43, 3, 15),
	]);
	assertEquals(historicalTimeBounds({ kind: "period", start: null, end: null }), [null, null]);
	assertEquals(
		formatHistoricalTime({ kind: "period", start: null, end: null }),
		"開始不明〜終了不明",
	);
	assert(
		v.safeParse(HistoricalTimeSchema, {
			kind: "period",
			start,
			end: { precision: "year", year: -43 },
		}).success,
	);
});
