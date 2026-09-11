import * as v from "valibot";
import {
	type HistoricalDate,
	type HistoricalTime,
	HistoricalTimeSchema,
} from "../domain/historical_time.ts";

export interface HistoricalDateDraft {
	precision: HistoricalDate["precision"];
	era: "bce" | "ce";
	year: string;
	century: string;
	month: string;
	day: string;
	approximate: boolean;
	unknown: boolean;
}
export interface HistoricalTimeDraft {
	kind: "point" | "period";
	start: HistoricalDateDraft;
	end: HistoricalDateDraft;
	original: string;
}

function dateDraft(date: HistoricalDate | null = null): HistoricalDateDraft {
	const year = date && date.precision !== "century" ? date.year : 1;
	return {
		precision: date?.precision ?? "year",
		era: date?.precision === "century" ? date.era : year <= 0 ? "bce" : "ce",
		year: date && date.precision !== "century" ? String(year <= 0 ? 1 - year : year) : "",
		century: date?.precision === "century" ? String(date.century) : "",
		month: date && (date.precision === "month" || date.precision === "day")
			? String(date.month)
			: "",
		day: date?.precision === "day" ? String(date.day) : "",
		approximate: date?.approximate ?? false,
		unknown: date === null,
	};
}

export function historicalTimeDraft(value?: HistoricalTime): HistoricalTimeDraft {
	return {
		kind: value?.kind ?? "point",
		start: dateDraft(value?.kind === "point" ? value.date : value?.start),
		end: dateDraft(value?.kind === "period" ? value.end : null),
		original: value?.original ?? "",
	};
}

function positiveInteger(value: string): number {
	if (!/^\d+$/.test(value.trim()) || Number(value) < 1) {
		throw new Error("年月日・世紀は1以上の整数で入力してください");
	}
	return Number(value);
}

function parseDate(draft: HistoricalDateDraft) {
	const { precision, approximate } = draft;
	if (precision === "century") {
		return { precision, approximate, era: draft.era, century: positiveInteger(draft.century) };
	}
	const inputYear = positiveInteger(draft.year);
	const year = draft.era === "bce" ? 1 - inputYear : inputYear;
	if (precision === "year") return { precision, year, approximate };
	const month = positiveInteger(draft.month);
	return precision === "month"
		? { precision, year, month, approximate }
		: { precision, year, month, day: positiveInteger(draft.day), approximate };
}

export function parseHistoricalTimeDraft(draft: HistoricalTimeDraft): HistoricalTime {
	const original = draft.original || undefined;
	return v.parse(
		HistoricalTimeSchema,
		draft.kind === "point" ? { kind: "point", date: parseDate(draft.start), original } : {
			kind: "period",
			start: draft.start.unknown ? null : parseDate(draft.start),
			end: draft.end.unknown ? null : parseDate(draft.end),
			original,
		},
	);
}
