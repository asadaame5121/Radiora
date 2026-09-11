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

export function historicalTimelineTicks(domain: [number, number], count: number) {
	const [min, max] = domain;
	const span = max - min;
	const step = Math.max(1, span / Math.max(2, count));
	const unit = step >= YEAR_DAYS ? "year" : step >= MONTH_DAYS ? "month" : "day";
	const rawStride = unit === "year"
		? step / YEAR_DAYS
		: unit === "month"
		? step / MONTH_DAYS
		: step;
	const power = 10 ** Math.floor(Math.log10(rawStride));
	const stride = Math.max(1, Math.ceil(rawStride / power) * power);
	const first = historicalDateFromDay(Math.max(historicalDay(-MAX_HISTORICAL_YEAR), min));
	const marks: Array<{ value: number; label: string }> = [];
	let cursor = unit === "year"
		? Math.ceil(first.year / stride) * stride
		: unit === "month"
		? first.year * MONTHS_PER_YEAR + first.month - 1
		: Math.ceil(min);
	for (let index = 0; index < MAX_MARKS; index++, cursor += stride) {
		const year = unit === "year" ? cursor : Math.floor(cursor / MONTHS_PER_YEAR);
		const month = ((cursor % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR + 1;
		const value = unit === "day" ? cursor : historicalDay(year, unit === "month" ? month : 1);
		if (value > max || value >= historicalDay(MAX_HISTORICAL_YEAR + 1)) break;
		if (value < min) continue;
		const date = historicalDateFromDay(value);
		const label = formatHistoricalYear(date.year) + (unit !== "year" ? `${date.month}月` : "") +
			(unit === "day" ? `${date.day}日` : "");
		marks.push({ value, label });
	}
	return marks;
}
