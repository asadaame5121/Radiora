import * as v from "valibot";
import {
	daysInHistoricalMonth,
	formatHistoricalYear,
	historicalDay,
	MAX_HISTORICAL_YEAR,
	MONTHS_PER_YEAR,
	YEARS_PER_CENTURY,
} from "./historical_calendar.ts";

const YearSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(-MAX_HISTORICAL_YEAR),
	v.maxValue(MAX_HISTORICAL_YEAR),
);
const MonthSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MONTHS_PER_YEAR));
const approximate = v.optional(v.boolean(), false);
const DateFieldsSchema = v.variant("precision", [
	v.strictObject({
		precision: v.literal("century"),
		era: v.picklist(["bce", "ce"]),
		century: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(Math.floor(MAX_HISTORICAL_YEAR / YEARS_PER_CENTURY)),
		),
		approximate,
	}),
	v.strictObject({ precision: v.literal("year"), year: YearSchema, approximate }),
	v.strictObject({
		precision: v.literal("month"),
		year: YearSchema,
		month: MonthSchema,
		approximate,
	}),
	v.strictObject({
		precision: v.literal("day"),
		year: YearSchema,
		month: MonthSchema,
		day: v.pipe(v.number(), v.integer(), v.minValue(1)),
		approximate,
	}),
]);
export const HistoricalDateSchema = v.pipe(
	DateFieldsSchema,
	v.check(
		(date) => date.precision !== "day" || date.day <= daysInHistoricalMonth(date.year, date.month),
		"存在しない日付です",
	),
);
export type HistoricalDate = v.InferOutput<typeof HistoricalDateSchema>;

/** Inclusive earliest/latest days compatible with the stated precision, not circa tolerance. */
export function historicalDateBounds(date: HistoricalDate): [number, number] {
	if (date.precision === "century") {
		const first = date.era === "ce"
			? (date.century - 1) * YEARS_PER_CENTURY + 1
			: 1 - date.century * YEARS_PER_CENTURY;
		return [historicalDay(first), historicalDay(first + YEARS_PER_CENTURY) - 1];
	}
	if (date.precision === "year") {
		return [historicalDay(date.year), historicalDay(date.year + 1) - 1];
	}
	if (date.precision === "month") {
		return [
			historicalDay(date.year, date.month),
			historicalDay(date.year, date.month, daysInHistoricalMonth(date.year, date.month)),
		];
	}
	const day = historicalDay(date.year, date.month, date.day);
	return [day, day];
}

export const HistoricalTimeSchema = v.pipe(
	v.variant("kind", [
		v.strictObject({
			kind: v.literal("point"),
			date: HistoricalDateSchema,
			original: v.optional(v.string()),
		}),
		v.strictObject({
			kind: v.literal("period"),
			start: v.nullable(HistoricalDateSchema),
			end: v.nullable(HistoricalDateSchema),
			original: v.optional(v.string()),
		}),
	]),
	v.check(
		(time) =>
			time.kind === "point" || time.start === null || time.end === null ||
			historicalDateBounds(time.start)[0] <= historicalDateBounds(time.end)[1],
		"開始が終了より後になっています",
	),
);
export type HistoricalTime = v.InferOutput<typeof HistoricalTimeSchema>;

export function historicalTimeBounds(time: HistoricalTime): [number | null, number | null] {
	return time.kind === "point" ? historicalDateBounds(time.date) : [
		time.start === null ? null : historicalDateBounds(time.start)[0],
		time.end === null ? null : historicalDateBounds(time.end)[1],
	];
}

export function formatHistoricalDate(date: HistoricalDate): string {
	let label = date.precision === "century"
		? `${date.era === "bce" ? "紀元前" : ""}${date.century}世紀`
		: formatHistoricalYear(date.year);
	if (date.precision === "month" || date.precision === "day") label += `${date.month}月`;
	if (date.precision === "day") label += `${date.day}日`;
	return label + (date.approximate ? "頃" : "");
}

export function formatHistoricalTime(time: HistoricalTime): string {
	const normalized = time.kind === "point"
		? formatHistoricalDate(time.date)
		: `${time.start === null ? "開始不明" : formatHistoricalDate(time.start)}〜${
			time.end === null ? "終了不明" : formatHistoricalDate(time.end)
		}`;
	return time.original ? `${time.original}（${normalized}）` : normalized;
}
