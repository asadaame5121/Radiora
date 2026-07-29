import { assertEquals } from "jsr:@std/assert@1";
import { parseAdvancedLinkInput } from "../src/services/advanced_link_parser.ts";
import { reconcileAdvancedLinkSelections } from "../src/ui/advanced_link_selection.ts";

Deno.test("Advanced Link token remains stable while the parsed query is unchanged", () => {
	assertEquals(
		reconcileAdvancedLinkSelections(
			parseAdvancedLinkInput("Old name :: FROM :: Target"),
			{ sourceWorkId: "immutable-source", targetWorkId: "immutable-target" },
			{ source: "Old name", target: "Target" },
		),
		{
			selections: { sourceWorkId: "immutable-source", targetWorkId: "immutable-target" },
			queries: { source: "Old name", target: "Target" },
		},
	);
});

Deno.test("editing one Advanced Link endpoint clears only that endpoint token", () => {
	assertEquals(
		reconcileAdvancedLinkSelections(
			parseAdvancedLinkInput("New source :: FROM :: Target"),
			{ sourceWorkId: "old-source", targetWorkId: "stable-target" },
			{ source: "Old source", target: "Target" },
		),
		{
			selections: { targetWorkId: "stable-target" },
			queries: { target: "Target" },
		},
	);
});
