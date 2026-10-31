import { expect, test } from "vitest";
import { parseAdvancedLinkInput } from "../../../src/services/advanced_link_parser.ts";
import { reconcileAdvancedLinkSelections } from "../../../src/ui/advanced_link_selection.ts";

test("Advanced Link token remains stable while the parsed query is unchanged", () => {
	expect(
		reconcileAdvancedLinkSelections(
			parseAdvancedLinkInput("Old name :: FROM :: Target"),
			{ sourceWorkId: "immutable-source", targetWorkId: "immutable-target" },
			{ source: "Old name", target: "Target" },
		),
	).toEqual({
		selections: { sourceWorkId: "immutable-source", targetWorkId: "immutable-target" },
		queries: { source: "Old name", target: "Target" },
	});
});

test("editing one Advanced Link endpoint clears only that endpoint token", () => {
	expect(
		reconcileAdvancedLinkSelections(
			parseAdvancedLinkInput("New source :: FROM :: Target"),
			{ sourceWorkId: "old-source", targetWorkId: "stable-target" },
			{ source: "Old source", target: "Target" },
		),
	).toEqual({
		selections: { targetWorkId: "stable-target" },
		queries: { target: "Target" },
	});
});
