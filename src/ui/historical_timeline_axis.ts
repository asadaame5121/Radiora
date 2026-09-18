import {
	formatHistoricalYear,
	historicalDateFromDay,
	historicalDay,
	MAX_HISTORICAL_YEAR,
	MONTHS_PER_YEAR,
} from "../domain/historical_calendar.ts";

const YEAR_DAYS = 366;
const MONTH_DAYS = 31;
const MAX_MARKS = 200;
type TickUnit = "year" | "month" | "day";

function tickScale(span: number, count: number): { unit: TickUnit; stride: number } {
	const step = Math.max(1, span / Math.max(2, count));
	const unit = step >= YEAR_DAYS ? "year" : step >= MONTH_DAYS ? "month" : "day";
	const rawStride = unit === "year"
		? step / YEAR_DAYS
		: unit === "month"
		? step / MONTH_DAYS
		: step;
	const power = 10 ** Math.floor(Math.log10(rawStride));
	return { unit, stride: Math.max(1, Math.ceil(rawStride / power) * power) };
}

function initialCursor(unit: TickUnit, stride: number, start: number): number {
	if (unit === "day") return Math.ceil(start);
	const first = historicalDateFromDay(start);
	const cursor = unit === "year" ? first.year : first.year * MONTHS_PER_YEAR + first.month - 1;
	return Math.ceil(cursor / stride) * stride;
}

function tickValue(unit: TickUnit, cursor: number): number {
	if (unit === "day") return cursor;
	const year = unit === "year" ? cursor : Math.floor(cursor / MONTHS_PER_YEAR);
	const month = ((cursor % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR + 1;
	return historicalDay(year, unit === "month" ? month : 1);
}

function tickLabel(value: number, unit: TickUnit): string {
	const date = historicalDateFromDay(value);
	return formatHistoricalYear(date.year) + (unit !== "year" ? `${date.month}月` : "") +
		(unit === "day" ? `${date.day}日` : "");
}

export function historicalTimelineTicks(domain: [number, number], count: number) {
	const [min, max] = domain;
	const { unit, stride } = tickScale(max - min, count);
	const firstDay = historicalDay(-MAX_HISTORICAL_YEAR);
	const endExclusive = historicalDay(MAX_HISTORICAL_YEAR + 1);
	const start = Math.max(firstDay, min);
	const end = Math.min(endExclusive - 1, max);
	if (start > end) return [];
	const marks: Array<{ value: number; label: string }> = [];
	let cursor = initialCursor(unit, stride, start);
	for (let index = 0; index < MAX_MARKS; index++, cursor += stride) {
		const value = tickValue(unit, cursor);
		if (value > end || value >= endExclusive) break;
		if (value < firstDay || value < start) continue;
		marks.push({ value, label: tickLabel(value, unit) });
	}
	return marks;
}
