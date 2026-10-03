import type { ComparisonTarget, ScreenDestination } from "./screen_navigation_destination.ts";
import type { ComparisonNavigationContext } from "./comparison_controller.svelte.ts";
import type { DateRange } from "../services/date_projection.ts";
import type { WorkView } from "./work_controller.svelte.ts";

/** Composes feature preparation ports without giving requesters a publication callback. */
export class ScreenDestinationPresenter {
	constructor(
		private readonly ports: {
			comparison: {
				prepareScreen(target: ComparisonTarget): Promise<ComparisonNavigationContext>;
				restoreNavigationContext(context: ComparisonNavigationContext): void;
			};
			dates: { prepareScreen(range: DateRange): Promise<() => void> };
			work: { prepareScreen(view: WorkView): Promise<() => void> };
			tags: { prepareScreen(): Promise<() => void> };
		},
	) {}

	async prepare(destination: ScreenDestination): Promise<() => void> {
		if (destination.comparison) {
			const context = await this.ports.comparison.prepareScreen(destination.comparison);
			return () => this.ports.comparison.restoreNavigationContext(context);
		}
		if (destination.dateRange) return this.ports.dates.prepareScreen(destination.dateRange);
		if (["unplaced", "stubs", "duplicates", "trash"].includes(destination.view)) {
			const view = destination.view;
			if (view === "unplaced" || view === "stubs" || view === "duplicates" || view === "trash") {
				return this.ports.work.prepareScreen(view);
			}
		}
		if (destination.view === "tags") {
			const [tags, work] = await Promise.all([
				this.ports.tags.prepareScreen(),
				this.ports.work.prepareScreen("unplaced"),
			]);
			return () => {
				tags();
				work();
			};
		}
		return () => undefined;
	}
}
