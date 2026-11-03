import { expect, test } from "vitest";
import { expectThrown } from "../support/expect_errors.ts";
import fc from "fast-check";
import {
	daysInHistoricalMonth,
	formatHistoricalYear,
	historicalDateFromDay,
	historicalDay,
	MAX_HISTORICAL_YEAR,
} from "../../../src/domain/historical_calendar.ts";

/** 有効な歴史日付（年・月・日）を生成する Arbitrary */
const validHistoricalDateArbitrary = fc
	.integer({ min: -MAX_HISTORICAL_YEAR, max: MAX_HISTORICAL_YEAR })
	.chain((year) =>
		fc.integer({ min: 1, max: 12 }).chain((month) => {
			const maxDay = daysInHistoricalMonth(year, month);
			return fc.integer({ min: 1, max: maxDay }).map((day) => ({
				year,
				month,
				day,
			}));
		}),
	);

const minCoordinate = historicalDay(-MAX_HISTORICAL_YEAR, 1, 1);
const maxCoordinate = historicalDay(MAX_HISTORICAL_YEAR, 12, 31);
const validCoordinateArbitrary = fc.integer({ min: minCoordinate, max: maxCoordinate });

test("Property: Date -> Day -> Date round-trip preserves all valid dates", () => {
	void fc.assert(
		fc.property(validHistoricalDateArbitrary, ({ year, month, day }) => {
			const coordinate = historicalDay(year, month, day);
			expect(historicalDateFromDay(coordinate)).toEqual({ year, month, day });
		}),
		{ numRuns: 200 },
	);
});

test("Property: Day -> Date -> Day round-trip preserves all valid coordinates", () => {
	void fc.assert(
		fc.property(validCoordinateArbitrary, (coordinate) => {
			const date = historicalDateFromDay(coordinate);
			expect(historicalDay(date.year, date.month, date.day)).toEqual(coordinate);
		}),
		{ numRuns: 200 },
	);
});

test("Property: Next calendar day coordinate is always current + 1", () => {
	void fc.assert(
		fc.property(validHistoricalDateArbitrary, ({ year, month, day }) => {
			const currentCoord = historicalDay(year, month, day);
			const maxDay = daysInHistoricalMonth(year, month);

			if (day < maxDay) {
				// 月中の翌日
				expect(historicalDay(year, month, day + 1) - currentCoord).toEqual(1);
			} else if (month < 12) {
				// 月末から翌月1日
				expect(historicalDay(year, month + 1, 1) - currentCoord).toEqual(1);
			} else if (year < MAX_HISTORICAL_YEAR) {
				// 年末から翌年1月1日
				expect(historicalDay(year + 1, 1, 1) - currentCoord).toEqual(1);
			}
		}),
		{ numRuns: 200 },
	);
});

test("Property: daysInHistoricalMonth satisfies Gregorian rules for all years", () => {
	void fc.assert(
		fc.property(
			fc.integer({ min: -MAX_HISTORICAL_YEAR, max: MAX_HISTORICAL_YEAR }),
			fc.integer({ min: 1, max: 12 }),
			(year, month) => {
				const days = daysInHistoricalMonth(year, month);
				if (month === 2) {
					const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
					expect(days).toEqual(isLeap ? 29 : 28);
				} else if ([4, 6, 9, 11].includes(month)) {
					expect(days).toEqual(30);
				} else {
					expect(days).toEqual(31);
				}
			},
		),
		{ numRuns: 200 },
	);
});

test("Property: Out-of-bounds coordinates throw RangeError", () => {
	const outOfBoundsArbitrary = fc.oneof(
		fc.integer({ max: minCoordinate - 1 }),
		fc.integer({ min: maxCoordinate + 1 }),
		fc.constant(Number.NaN),
		fc.constant(Number.POSITIVE_INFINITY),
		fc.constant(Number.NEGATIVE_INFINITY),
	);

	void fc.assert(
		fc.property(outOfBoundsArbitrary, (coordinate) => {
			expectThrown(() => historicalDateFromDay(coordinate), RangeError);
		}),
		{ numRuns: 100 },
	);
});

test("Property: formatHistoricalYear produces correct Japanese era representations", () => {
	void fc.assert(
		fc.property(fc.integer({ min: -MAX_HISTORICAL_YEAR, max: MAX_HISTORICAL_YEAR }), (year) => {
			const formatted = formatHistoricalYear(year);
			if (year <= 0) {
				expect(formatted).toEqual(`紀元前${1 - year}年`);
			} else {
				expect(formatted).toEqual(`${year}年`);
			}
		}),
		{ numRuns: 100 },
	);
});
