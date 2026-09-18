import type { DateRange } from "../services/date_projection.ts";

export function formatCreatedAt(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "不明" : date.toLocaleDateString("ja-JP");
}

export function formatRecentEditAt(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "更新日時不明" : date.toLocaleString("ja-JP", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function localDateValue(date: Date): string {
	const offset = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
	const copy = new Date(date);
	copy.setDate(copy.getDate() + days);
	return copy;
}

export function dateRangeFromInputs(start: string, end: string): DateRange {
	const startDate = new Date(`${start}T00:00:00`);
	const endDate = new Date(`${end}T00:00:00`);
	if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
		throw new Error("開始日と終了日を入力してください。");
	}
	return { startInclusive: startDate.toISOString(), endExclusive: endDate.toISOString() };
}
