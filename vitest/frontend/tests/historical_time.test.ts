import { expect, test } from "vitest";
import { expectThrown } from "../support/expect_errors.ts";
import * as v from "valibot";
import {
	formatHistoricalYear,
	historicalDateFromDay,
	historicalDay,
} from "../../../src/domain/historical_calendar.ts";
import {
	formatHistoricalTime,
	historicalDateBounds,
	HistoricalDateSchema,
	historicalTimeBounds,
	HistoricalTimeSchema,
} from "../../../src/domain/historical_time.ts";

test("historical calendar crosses BCE without a display year zero and round-trips days", () => {
	expect([-1, 0, 1].map(formatHistoricalYear)).toEqual(["紀元前2年", "紀元前1年", "1年"]);
	expect(formatHistoricalYear(-43)).toEqual("紀元前44年");
	for (const year of [-999999, -400, -43, -1, 0, 1, 99, 100, 400, 1604, 1867, 999999]) {
		for (const month of [1, 2, 3, 12]) {
			expect(historicalDateFromDay(historicalDay(year, month, 15))).toEqual({
				year,
				month,
				day: 15,
			});
		}
		expect(historicalDay(year + 1) - historicalDay(year, 12, 31)).toEqual(1);
	}
	expect(historicalDateFromDay(historicalDay(0, 12, 31) + 1)).toEqual({
		year: 1,
		month: 1,
		day: 1,
	});
	for (const coordinate of [NaN, Infinity, historicalDay(-999999) - 1, historicalDay(1000000)]) {
		expectThrown(() => historicalDateFromDay(coordinate), RangeError);
	}
});

test("historical precision and circa preserve uncertainty without manufacturing tolerance", () => {
	const date = v.parse(HistoricalDateSchema, {
		precision: "century",
		era: "ce",
		century: 15,
		approximate: true,
	});
	expect(historicalDateBounds(date)).toEqual([historicalDay(1401), historicalDay(1501) - 1]);
	expect(formatHistoricalTime({ kind: "point", date })).toEqual("15世紀頃");
	expect(formatHistoricalTime({ kind: "point", date, original: "十五世紀頃" })).toEqual(
		"十五世紀頃（15世紀頃）",
	);
	expect(
		historicalDateBounds(
			v.parse(HistoricalDateSchema, { precision: "century", era: "bce", century: 1 }),
		),
	).toEqual([historicalDay(-99), historicalDay(1) - 1]);
	expect(
		historicalDateBounds(v.parse(HistoricalDateSchema, { precision: "month", year: 0, month: 2 })),
	).toEqual([historicalDay(0, 2), historicalDay(0, 3) - 1]);
});

test("historical schemas reject invalid dates and reversed periods and accept unknown endpoints", () => {
	for (const year of [0, -400, 2000]) {
		expect(
			v.safeParse(HistoricalDateSchema, { precision: "day", year, month: 2, day: 29 }).success,
		).toBeTruthy();
	}
	for (const value of [
		{ precision: "day", year: 1900, month: 2, day: 29 },
		{ precision: "day", year: 1604, month: 4, day: 31 },
		{ precision: "year", year: Infinity },
		{ precision: "year", year: 1.5 },
		{ precision: "year", year: 1000000 },
		{ precision: "month", year: 1, month: 13 },
		{ precision: "century", era: "ce", century: 0 },
	])
		expect(!v.safeParse(HistoricalDateSchema, value).success).toBeTruthy();
	const start = { precision: "year", year: 1604 };
	const end = { precision: "year", year: 1867 };
	const period = v.parse(HistoricalTimeSchema, { kind: "period", start, end });
	expect(historicalTimeBounds(period)).toEqual([historicalDay(1604), historicalDay(1868) - 1]);
	expect(
		!v.safeParse(HistoricalTimeSchema, { kind: "period", start: end, end: start }).success,
	).toBeTruthy();
	for (const pair of [
		[start, null],
		[null, end],
		[null, null],
	]) {
		expect(
			v.safeParse(HistoricalTimeSchema, { kind: "period", start: pair[0], end: pair[1] }).success,
		).toBeTruthy();
	}
});

test("historical periods preserve unknown endpoints and allow overlapping precision", () => {
	const start = v.parse(HistoricalDateSchema, { precision: "day", year: -43, month: 3, day: 15 });
	expect(start.approximate).toEqual(false);
	expect(formatHistoricalTime({ kind: "point", date: start })).toEqual("紀元前44年3月15日");
	expect(historicalTimeBounds({ kind: "period", start, end: null })).toEqual([
		historicalDay(-43, 3, 15),
		null,
	]);
	expect(historicalTimeBounds({ kind: "period", start: null, end: start })).toEqual([
		null,
		historicalDay(-43, 3, 15),
	]);
	expect(historicalTimeBounds({ kind: "period", start: null, end: null })).toEqual([null, null]);
	expect(formatHistoricalTime({ kind: "period", start: null, end: null })).toEqual(
		"開始不明〜終了不明",
	);
	expect(
		v.safeParse(HistoricalTimeSchema, {
			kind: "period",
			start,
			end: { precision: "year", year: -43 },
		}).success,
	).toBeTruthy();
});
