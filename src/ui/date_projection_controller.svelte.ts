import type { DateProjection, DateRange } from "../domain/models.ts";
import { addDays, dateRangeFromInputs, localDateValue } from "./calendar_display.ts";

export interface DateProjectionControllerOptions {
	projectDates: (range: DateRange) => Promise<DateProjection>;
	onError: (cause: unknown) => void;
	onOpenView?: (view: "today") => void;
}

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

	load = async (): Promise<void> => {
		try {
			this.loading = true;
			this.projection = await this.options.projectDates(
				dateRangeFromInputs(this.start, this.end),
			);
			this.options.onOpenView?.("today");
		} catch (cause) {
			this.options.onError(cause);
		} finally {
			this.loading = false;
		}
	};

	openToday = async (): Promise<void> => {
		const now = new Date();
		this.start = localDateValue(now);
		this.end = localDateValue(addDays(now, 1));
		await this.load();
	};

	moveRange = async (days: number): Promise<void> => {
		const startDate = new Date(`${this.start}T00:00:00`);
		const endDate = new Date(`${this.end}T00:00:00`);
		this.start = localDateValue(addDays(startDate, days));
		this.end = localDateValue(addDays(endDate, days));
		await this.load();
	};

	showWeek = async (): Promise<void> => {
		const today = new Date();
		const offset = (today.getDay() + 6) % 7;
		const monday = addDays(today, -offset);
		this.start = localDateValue(monday);
		this.end = localDateValue(addDays(monday, 7));
		await this.load();
	};
}
