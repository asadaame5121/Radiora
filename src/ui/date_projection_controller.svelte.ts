import type { DateProjection, DateRange } from "../services/date_projection.ts";
import { addDays, dateRangeFromInputs, localDateValue } from "./calendar_display.ts";

import type { ScreenNavigator } from "./screen_navigation_destination.ts";

export interface DateProjectionControllerOptions {
	projectDates: (range: DateRange) => Promise<DateProjection>;
	onError: (cause: unknown) => void;
	navigation: ScreenNavigator;
}

const DAYS_IN_WEEK = 7;
const MONDAY_INDEX_OFFSET = 6;

export class DateProjectionController {
	start = $state(localDateValue(new Date()));
	end = $state(localDateValue(addDays(new Date(), 1)));
	projection = $state<DateProjection | null>(null);

	constructor(private readonly options: DateProjectionControllerOptions) {}

	setStart = (value: string): void => {
		this.start = value;
	};

	setEnd = (value: string): void => {
		this.end = value;
	};

	prepareScreen = async (range: DateRange): Promise<() => void> => {
		const projection = await this.options.projectDates(range);
		return () => {
			this.start = localDateValue(new Date(range.startInclusive));
			this.end = localDateValue(new Date(range.endExclusive));
			this.projection = projection;
		};
	};

	load = async (): Promise<void> => {
		await this.requestRange(new Date(`${this.start}T00:00:00`), new Date(`${this.end}T00:00:00`));
	};

	openToday = async (): Promise<void> => {
		const now = new Date();
		await this.requestRange(now, addDays(now, 1));
	};

	moveRange = async (days: number): Promise<void> => {
		await this.requestRange(
			addDays(new Date(`${this.start}T00:00:00`), days),
			addDays(new Date(`${this.end}T00:00:00`), days),
		);
	};

	showWeek = async (): Promise<void> => {
		const today = new Date();
		const offset = (today.getDay() + MONDAY_INDEX_OFFSET) % DAYS_IN_WEEK;
		const monday = addDays(today, -offset);
		await this.requestRange(monday, addDays(monday, DAYS_IN_WEEK));
	};

	private async requestRange(start: Date, end: Date): Promise<void> {
		try {
			const range = dateRangeFromInputs(
				Number.isFinite(start.getTime()) ? localDateValue(start) : "",
				Number.isFinite(end.getTime()) ? localDateValue(end) : "",
			);
			await this.options.navigation.navigate({ view: "today", dateRange: range });
		} catch (cause) {
			this.options.onError(cause);
		}
	}
}
