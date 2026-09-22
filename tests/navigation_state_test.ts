import { assertEquals } from "jsr:@std/assert@1";
import { navigationUiState } from "../src/ui/navigation_state.ts";

Deno.test("bookmark open maps resolution to temporary expansion, centered selection, and highlight", () => {
	assertEquals(
		navigationUiState({
			kind: "occurrence",
			workId: "work",
			occurrenceId: "target",
			ancestorOccurrenceIds: ["root", "parent"],
			fellBack: false,
		}, 4),
		{
			selectedOccurrenceId: "target",
			temporaryExpandedOccurrenceIds: ["root", "parent"],
			center: true,
			highlight: true,
			caretOffset: 4,
		},
	);
});

Deno.test("navigationUiState omits caretOffset when not provided", () => {
	const state = navigationUiState({
		kind: "occurrence",
		workId: "work",
		occurrenceId: "target",
		ancestorOccurrenceIds: ["root"],
		fellBack: false,
	});
	assertEquals(state, {
		selectedOccurrenceId: "target",
		temporaryExpandedOccurrenceIds: ["root"],
		center: true,
		highlight: true,
	});
	assertEquals("caretOffset" in state, false);
});

Deno.test("navigationUiState returns default state for work target", () => {
	assertEquals(
		navigationUiState({
			kind: "work",
			workId: "work",
			fellBack: true,
		}),
		{
			selectedOccurrenceId: null,
			temporaryExpandedOccurrenceIds: [],
			center: false,
			highlight: false,
		},
	);
});
