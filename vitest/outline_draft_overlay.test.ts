import { expect, test } from "vitest";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import type { WorkingCopyDraft } from "../src/services/working_copy_autosave.ts";
import { branchKey, overlayDrafts } from "../src/ui/outline_draft_overlay.ts";

function item(workId: string, branchId: string): OutlineItem {
	return {
		id: `${workId}/${branchId}`,
		workId,
		text: "saved",
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId },
		createdAt: "now",
		updatedAt: "now",
	};
}

function draft(workId: string, branchId: string, text: string): WorkingCopyDraft {
	return {
		workId,
		branchId,
		occurrenceId: "any",
		text,
		status: { workId, branchId, phase: "unsaved" },
	};
}

test("overlay isolates Work/branch/pinned selectors, keeps latest empty text and does not mutate input", () => {
	const main = item("work", "main");
	const snapshot: OutlineSnapshot = {
		items: [main, { ...main, id: "mirror" }, item("work", "side"), item("other", "main"), {
			...main,
			id: "pinned",
			revisionSelector: { mode: "pinned", revisionId: "rev" },
		}],
		links: [],
		knots: [],
		stashItemIds: [],
	};
	const next = overlayDrafts(snapshot, [
		draft("work", "main", "initial"),
		draft("work", "main", ""),
	]);
	expect(next.items.map((value) => value.text)).toEqual(["", "", "saved", "saved", "saved"]);
	expect(snapshot.items.every((value) => value.text === "saved")).toBe(true);
	expect(next.items.every((value, index) => value !== snapshot.items[index])).toBe(true);
});

test("identifiers with delimiters do not collide in overlay or read edit identity", () => {
	const a = item("a,b", "c");
	const b = item("a", "b,c");
	const snapshot: OutlineSnapshot = { items: [a, b], links: [], knots: [], stashItemIds: [] };
	expect(overlayDrafts(snapshot, [draft("a,b", "c", "edited")]).items.map((value) => value.text))
		.toEqual(["edited", "saved"]);
	expect(branchKey(a)).not.toBe(branchKey(b));
	expect(branchKey(a)).toBe(branchKey({ ...a, id: "mirror" }));
	expect(branchKey(a)).not.toBe(
		branchKey({ ...a, revisionSelector: { mode: "pinned", revisionId: "c" } }),
	);
});
