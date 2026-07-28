import type { NavigationTarget } from "../domain/models.ts";

export interface NavigationUiState {
	selectedOccurrenceId: string | null;
	temporaryExpandedOccurrenceIds: string[];
	center: boolean;
	highlight: boolean;
	caretOffset?: number;
}

export function navigationUiState(
	target: NavigationTarget,
	caretOffset?: number,
): NavigationUiState {
	if (target.kind === "work") {
		return {
			selectedOccurrenceId: null,
			temporaryExpandedOccurrenceIds: [],
			center: false,
			highlight: false,
		};
	}
	return {
		selectedOccurrenceId: target.occurrenceId,
		temporaryExpandedOccurrenceIds: [...target.ancestorOccurrenceIds],
		center: true,
		highlight: true,
		...(caretOffset === undefined ? {} : { caretOffset }),
	};
}
