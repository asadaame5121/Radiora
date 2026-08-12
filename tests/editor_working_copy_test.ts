import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem } from "../src/domain/models.ts";
import { applyBranchWorkingCopyText } from "../src/ui/editor_working_copy.ts";

function item(id: string, branchId: string, text: string): OutlineItem {
	return {
		id,
		workId: "work",
		text,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId },
		createdAt: "2026-08-12T00:00:00.000Z",
		updatedAt: "2026-08-12T00:00:00.000Z",
	};
}

Deno.test("optimistic edits update only placements of the selected Branch", () => {
	const main = item("main", "branch-main", "main text");
	const mainMirror = item("main-mirror", "branch-main", "main text");
	const alternate = item("alternate", "branch-alternate", "alternate text");

	applyBranchWorkingCopyText(
		[main, mainMirror, alternate],
		alternate,
		"edited alternate",
		"2026-08-12T01:00:00.000Z",
	);

	assertEquals([main.text, mainMirror.text, alternate.text], [
		"main text",
		"main text",
		"edited alternate",
	]);
});
