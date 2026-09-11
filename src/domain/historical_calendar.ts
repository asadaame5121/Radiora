/** Proleptic Gregorian day coordinates, with astronomical year 0 as the epoch. */
export const MAX_HISTORICAL_YEAR = 999_999;
export const MONTHS_PER_YEAR = 12;
export const YEARS_PER_CENTURY = 100;
const DAYS_PER_YEAR = 365;
const GREGORIAN_CYCLE = 400;
const LEAP_CYCLE = 4;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInHistoricalMonth(year: number, month: number): number {
	const leap = year % LEAP_CYCLE === 0 &&
		(year % YEARS_PER_CENTURY !== 0 || year % GREGORIAN_CYCLE === 0);
	return month === 2 && leap ? 29 : MONTH_LENGTHS[month - 1] ?? 0;
}

export function historicalDay(year: number, month = 1, day = 1): number {
	let result = DAYS_PER_YEAR * year + Math.floor((year + LEAP_CYCLE - 1) / LEAP_CYCLE) -
		Math.floor((year + YEARS_PER_CENTURY - 1) / YEARS_PER_CENTURY) +
		Math.floor((year + GREGORIAN_CYCLE - 1) / GREGORIAN_CYCLE);
	for (let current = 1; current < month; current++) {
		result += daysInHistoricalMonth(year, current);
	}
	return result + day - 1;
}

export function historicalDateFromDay(coordinate: number) {
	const target = Math.floor(coordinate);
	let low = -MAX_HISTORICAL_YEAR - 1;
	let high = MAX_HISTORICAL_YEAR + 2;
	while (low + 1 < high) {
		const mid = Math.floor((low + high) / 2);
		if (historicalDay(mid) <= target) low = mid;
		else high = mid;
	}
	let remaining = target - historicalDay(low);
	let month = 1;
	while (month < MONTHS_PER_YEAR && remaining >= daysInHistoricalMonth(low, month)) {
		remaining -= daysInHistoricalMonth(low, month++);
	}
	return { year: low, month, day: remaining + 1 };
}

export function formatHistoricalYear(year: number): string {
	return year <= 0 ? `紀元前${1 - year}年` : `${year}年`;
}
