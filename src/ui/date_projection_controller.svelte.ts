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
	loading = $state(false);

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
			this.projection = projection;
		};
	};

	load = async (): Promise<void> => {
		await this.options.navigation.navigate({
			view: "today",
			dateRange: dateRangeFromInputs(this.start, this.end),
		});
	};

	openToday = async (): Promise<void> => {
		const now = new Date();
		this.start = localDateValue(now);
		this.end = localDateValue(addDays(now, 1));
		await this.load();
	};

	moveRange = async (days: number): Promise<void> => {
		this.start = localDateValue(addDays(new Date(`${this.start}T00:00:00`), days));
		this.end = localDateValue(addDays(new Date(`${this.end}T00:00:00`), days));
		await this.load();
	};

	showWeek = async (): Promise<void> => {
		const today = new Date();
		const offset = (today.getDay() + MONDAY_INDEX_OFFSET) % DAYS_IN_WEEK;
		const monday = addDays(today, -offset);
		this.start = localDateValue(monday);
		this.end = localDateValue(addDays(monday, DAYS_IN_WEEK));
		await this.load();
	};
}
