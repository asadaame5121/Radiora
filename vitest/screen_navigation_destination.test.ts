import { expect, test } from "vitest";
import { validateDestinationOccurrence } from "../src/ui/screen_navigation_destination.ts";

test.each([undefined, null, ""])(
	"an unspecified occurrence does not require a live target: %s",
	(id) => {
		expect(() => validateDestinationOccurrence(id, { items: [] })).not.toThrow();
	},
);

test("an explicit missing occurrence is rejected", () => {
	expect(() => validateDestinationOccurrence("missing", { items: [] })).toThrow(
		"移動先の項目が見つかりません。",
	);
});
