import { expect, test } from "vitest";
import type { OutlineItem, OutlineLink, OutlineSnapshot } from "../../../src/domain/models.ts";
import { buildTreeHighlightSet, resolveTreeSelectionId } from "../../../src/ui/tree_highlight.ts";

test("selection highlights the full FROM closure while hover stays direct", () => {
	const snapshot = outline(["a", "b", "c", "d"]);
	snapshot.links = [link("a", "b"), link("b", "c"), link("c", "d")];

	expect([...buildTreeHighlightSet(snapshot, "a", null)].sort()).toEqual(["a", "b", "c", "d"]);
	expect([...buildTreeHighlightSet(snapshot, "a", "b")].sort()).toEqual(["a", "b", "c"]);
});

test("selection resolves to the visible representative when its occurrence is absent", () => {
	const snapshot = outline(["representative", "other"]);
	snapshot.items[0].workId = "work-a";

	expect(resolveTreeSelectionId(snapshot, "secondary-occurrence", "work-a")).toEqual(
		"representative",
	);
	expect([...buildTreeHighlightSet(snapshot, "representative", null)].sort()).toEqual([
		"representative",
	]);
});

function outline(ids: string[]): OutlineSnapshot {
	return {
		items: ids.map(
			(id, orderKey): OutlineItem => ({
				id,
				workId: id,
				text: id,
				parentId: null,
				orderKey,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: `${id}-branch` },
				createdAt: "2026-08-05T00:00:00.000Z",
				updatedAt: "2026-08-05T00:00:00.000Z",
			}),
		),
		links: [],
		knots: [],
		stashItemIds: [],
	};
}

function link(fromId: string, toId: string): OutlineLink {
	return {
		id: `${fromId}-${toId}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type: "FROM",
		status: "asserted",
		origin: "human",
		createdAt: "2026-08-05T00:00:00.000Z",
	};
}
