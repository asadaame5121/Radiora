import { expect, test } from "vitest";
import { recoverRadioraDestination } from "../../../src/ui/overtype_markdown_editor_adapter.ts";

test("rendered and tooltip Radiora destinations recover without trusting sanitized href", () => {
	expect(recoverRadioraDestination("#", "](radiora://work/work-01)", "")).toEqual(
		"radiora://work/work-01",
	);
	expect(recoverRadioraDestination("#", "", "radiora://revision/revision-01#section")).toEqual(
		"radiora://revision/revision-01#section",
	);
	expect(recoverRadioraDestination("https://example.test", "](javascript:alert(1))", "")).toEqual(
		null,
	);
	expect(recoverRadioraDestination("#", "](radiora://work/bad/id)", "")).toEqual(null);
});
