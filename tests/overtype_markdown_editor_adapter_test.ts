import { assertEquals } from "jsr:@std/assert@1";
import { recoverRadioraDestination } from "../src/ui/overtype_markdown_editor_adapter.ts";

Deno.test("rendered and tooltip Radiora destinations recover without trusting sanitized href", () => {
	assertEquals(
		recoverRadioraDestination("#", "](radiora://work/work-01)", ""),
		"radiora://work/work-01",
	);
	assertEquals(
		recoverRadioraDestination("#", "", "radiora://revision/revision-01#section"),
		"radiora://revision/revision-01#section",
	);
	assertEquals(
		recoverRadioraDestination("https://example.test", "](javascript:alert(1))", ""),
		null,
	);
	assertEquals(recoverRadioraDestination("#", "](radiora://work/bad/id)", ""), null);
});
