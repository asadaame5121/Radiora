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

type AxisUnit = "year" | "month" | "day";

function computeScale(span: number, count: number): { unit: AxisUnit; stride: number } {
	const step = Math.max(1, span / Math.max(2, count));
	if (step >= YEAR_DAYS) {
		const raw = step / YEAR_DAYS;
		const power = 10 ** Math.floor(Math.log10(raw));
		return { unit: "year", stride: Math.max(1, Math.ceil(raw / power) * power) };
	}
	if (step >= MONTH_DAYS) {
		const raw = step / MONTH_DAYS;
		const power = 10 ** Math.floor(Math.log10(raw));
		return { unit: "month", stride: Math.max(1, Math.ceil(raw / power) * power) };
	}
	const power = 10 ** Math.floor(Math.log10(step));
	return { unit: "day", stride: Math.max(1, Math.ceil(step / power) * power) };
}

function formatTickLabel(date: ReturnType<typeof historicalDateFromDay>, unit: AxisUnit): string {
	const yearPart = formatHistoricalYear(date.year);
	if (unit === "year") return yearPart;
	if (unit === "month") return `${yearPart}${date.month}月`;
	return `${yearPart}${date.month}月${date.day}日`;
}

function computeTickValue(cursor: number, unit: AxisUnit): number {
	if (unit === "day") return cursor;
	const year = unit === "year" ? cursor : Math.floor(cursor / MONTHS_PER_YEAR);
	const month = unit === "month"
		? (((cursor % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR) + 1
		: 1;
	return historicalDay(year, month);
}

export function historicalTimelineTicks(domain: [number, number], count: number) {
	const [min, max] = domain;
	const { unit, stride } = computeScale(max - min, count);
	const first = historicalDateFromDay(Math.max(historicalDay(-MAX_HISTORICAL_YEAR), min));
	const firstMonth = first.year * MONTHS_PER_YEAR + first.month - 1;
	let cursor = unit === "year"
		? Math.ceil(first.year / stride) * stride
		: unit === "month"
		? Math.ceil(firstMonth / stride) * stride
		: Math.ceil(min);

	const marks: Array<{ value: number; label: string }> = [];
	for (let index = 0; index < MAX_MARKS; index++, cursor += stride) {
		const value = computeTickValue(cursor, unit);
		if (value > max || value >= historicalDay(MAX_HISTORICAL_YEAR + 1)) break;
		if (value < min) continue;
		marks.push({ value, label: formatTickLabel(historicalDateFromDay(value), unit) });
	}
	return marks;
}
