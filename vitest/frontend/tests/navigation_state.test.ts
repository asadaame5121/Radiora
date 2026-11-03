import { expect, test } from "vitest";
import { navigationUiState } from "../../../src/ui/navigation_state.ts";

test("bookmark open maps resolution to temporary expansion, centered selection, and highlight", () => {
	expect(
		navigationUiState(
			{
				kind: "occurrence",
				workId: "work",
				occurrenceId: "target",
				ancestorOccurrenceIds: ["root", "parent"],
				fellBack: false,
			},
			4,
		),
	).toEqual({
		selectedOccurrenceId: "target",
		temporaryExpandedOccurrenceIds: ["root", "parent"],
		center: true,
		highlight: true,
		caretOffset: 4,
	});
});

test("navigationUiState omits caretOffset when not provided", () => {
	const state = navigationUiState({
		kind: "occurrence",
		workId: "work",
		occurrenceId: "target",
		ancestorOccurrenceIds: ["root"],
		fellBack: false,
	});
	expect(state).toEqual({
		selectedOccurrenceId: "target",
		temporaryExpandedOccurrenceIds: ["root"],
		center: true,
		highlight: true,
	});
	expect("caretOffset" in state).toEqual(false);
});

test("navigationUiState returns default state for work target", () => {
	expect(
		navigationUiState({
			kind: "work",
			workId: "work",
			fellBack: true,
		}),
	).toEqual({
		selectedOccurrenceId: null,
		temporaryExpandedOccurrenceIds: [],
		center: false,
		highlight: false,
	});
});
