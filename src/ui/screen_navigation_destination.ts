import type { ViewMode } from "./app_view_mode.ts";
import type { DateRange } from "../services/date_projection.ts";
import type { EditorPosition } from "./editor_return_controller.svelte.ts";

export type ComparisonTarget =
	| { kind: "revision"; revisionId: string }
	| { kind: "work"; workId: string; scope: "branch" | "revision"; id: string }
	| { kind: "link"; linkId: string };

/** Destination values, never selection or screen commit callbacks. */
export interface ScreenDestination {
	view: ViewMode;
	occurrenceId?: string | null;
	hoistId?: string | null;
	expandedIds?: readonly string[];
	caretOffset?: number;
	editorPosition?: EditorPosition;
	longForm?: boolean;
	query?: boolean;
	comparison?: ComparisonTarget;
	dateRange?: DateRange;
}

export interface ScreenNavigator {
	readonly origin: number;
	navigate(destination: ScreenDestination, origin?: number): Promise<boolean>;
}
