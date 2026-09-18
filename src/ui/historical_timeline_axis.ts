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

type TimeUnit = "year" | "month" | "day";

function calculateUnitAndStride(span: number, count: number): { unit: TimeUnit; stride: number } {
	const step = Math.max(1, span / Math.max(2, count));
	const unit: TimeUnit = step >= YEAR_DAYS ? "year" : step >= MONTH_DAYS ? "month" : "day";
	const rawStride = unit === "year"
		? step / YEAR_DAYS
		: unit === "month"
		? step / MONTH_DAYS
		: step;
	const power = 10 ** Math.floor(Math.log10(rawStride));
	const stride = Math.max(1, Math.ceil(rawStride / power) * power);
	return { unit, stride };
}

function calculateInitialCursor(unit: TimeUnit, start: number, stride: number): number {
	if (unit === "day") return Math.ceil(start);
	const first = historicalDateFromDay(start);
	if (unit === "year") {
		return Math.ceil(first.year / stride) * stride;
	}
	const firstMonth = first.year * MONTHS_PER_YEAR + first.month - 1;
	return Math.ceil(firstMonth / stride) * stride;
}

function formatTickLabel(unit: TimeUnit, value: number): string {
	const date = historicalDateFromDay(value);
	const yearPart = formatHistoricalYear(date.year);
	const monthPart = unit !== "year" ? `${date.month}月` : "";
	const dayPart = unit === "day" ? `${date.day}日` : "";
	return `${yearPart}${monthPart}${dayPart}`;
}

function tickValueAt(unit: TimeUnit, cursor: number): number {
	if (unit === "day") return cursor;
	const year = unit === "year" ? cursor : Math.floor(cursor / MONTHS_PER_YEAR);
	const month = ((cursor % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR + 1;
	return historicalDay(year, unit === "month" ? month : 1);
}

export function historicalTimelineTicks(domain: [number, number], count: number) {
	const [min, max] = domain;
	const { unit, stride } = calculateUnitAndStride(max - min, count);
	const firstDay = historicalDay(-MAX_HISTORICAL_YEAR);
	const endExclusive = historicalDay(MAX_HISTORICAL_YEAR + 1);
	const start = Math.max(firstDay, min);
	const end = Math.min(endExclusive - 1, max);
	if (start > end) return [];
	const marks: Array<{ value: number; label: string }> = [];
	let cursor = calculateInitialCursor(unit, start, stride);
	for (let index = 0; index < MAX_MARKS; index++, cursor += stride) {
		const value = tickValueAt(unit, cursor);
		if (value > end || value >= endExclusive) break;
		if (value < firstDay || value < start) continue;
		marks.push({ value, label: formatTickLabel(unit, value) });
	}
	return marks;
}
