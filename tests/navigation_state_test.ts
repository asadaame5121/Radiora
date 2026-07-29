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
