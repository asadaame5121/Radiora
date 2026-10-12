import { expect, test } from "vitest";
import type { OutlineItem, OutlineLink } from "../src/domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../src/domain/relation_type.ts";
import * as projection from "../src/services/semantic_link_annotations.ts";
import { applyBranchWorkingCopyText } from "../src/ui/editor_working_copy.ts";
import { SemanticLinkAnnotationsController } from "../src/ui/semantic_link_annotations_controller.svelte.ts";

function item(id: string, workId = id, text = `${id} title\nbody`): OutlineItem {
	return {
		id,
		workId,
		text,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${workId}-main` },
		createdAt: "2026-10-12",
		updatedAt: "2026-10-12",
	};
}

function link(id: string, from: string, to: string): OutlineLink {
	return {
		id,
		fromId: from,
		toId: to,
		from: { scope: "work", workId: from },
		to: { scope: "work", workId: to },
		type: "SUPPORT",
		status: "asserted",
		origin: "human",
		createdAt: "2026-10-12",
		reason: "explained",
	};
}

function setup() {
	const state = $state({
		items: [item("a"), item("b"), item("c"), item("d"), item("empty")],
		links: [link("ab", "a", "b"), link("cd", "c", "d")],
		definitions: [...BUILT_IN_RELATION_TYPES],
	});
	const controller = new SemanticLinkAnnotationsController({
		items: () => state.items,
		links: () => state.links,
		relationTypeDefinitions: () => state.definitions,
	});
	return { state, controller };
}

test("body edits retain annotation arrays and objects", () => {
	const { state, controller } = setup();
	const before = controller.forOccurrence("b");
	state.items[0].text = "a title\nchanged body";
	expect(controller.forOccurrence("b")).toBe(before);
	expect(controller.forOccurrence("b")[0]).toBe(before[0]);
});

test("title edits update dependent annotations while retaining unrelated arrays and objects", () => {
	const { state, controller } = setup();
	const a = controller.forOccurrence("a");
	const b = controller.forOccurrence("b");
	const c = controller.forOccurrence("c");
	const empty = controller.forOccurrence("empty");
	state.items[0].text = "renamed\nbody";
	expect(controller.forOccurrence("b")[0].otherDisplayName).toBe("renamed");
	expect(controller.forOccurrence("b")).not.toBe(b);
	expect(controller.forOccurrence("a")).toBe(a);
	expect(controller.forOccurrence("c")).toBe(c);
	expect(controller.forOccurrence("c")[0]).toBe(c[0]);
	expect(controller.forOccurrence("empty")).toBe(empty);
});

test("the per-occurrence view agrees with the existing projection after structural and relation changes", () => {
	const { state, controller } = setup();
	const assertProjection = () => {
		const expected = projection.projectSemanticLinkAnnotations(
			state.items,
			state.links,
			state.definitions,
		);
		for (const entry of state.items) {
			expect(controller.forOccurrence(entry.id)).toEqual(
				expected.filter((annotation) => annotation.occurrenceId === entry.id),
			);
		}
	};
	assertProjection();
	state.items.push(item("a-second", "a", "different placement"));
	assertProjection();
	state.links[0].reason = "new explanation";
	state.links[0].type = "RELATED";
	assertProjection();
	state.links[1].status = "retracted";
	assertProjection();
	state.items = state.items.filter((entry) => entry.id !== "b");
	assertProjection();
	expect(controller.forOccurrence("b")).toEqual([]);
});

test("branch edits retain the existing representative rule without changing side branches or pinned text", () => {
	const { state, controller } = setup();
	state.items.push(
		item("a-second", "a"),
		{ ...item("a-side", "a"), revisionSelector: { mode: "branch", branchId: "side" } },
		{ ...item("a-pinned", "a"), revisionSelector: { mode: "pinned", revisionId: "revision" } },
	);
	const main = state.items[0];
	const sameBranch = state.items.find((entry) => entry.id === "a-second");
	const side = state.items.find((entry) => entry.id === "a-side");
	const pinned = state.items.find((entry) => entry.id === "a-pinned");
	if (!sameBranch || !side || !pinned) throw new Error("Missing branch fixture");
	const sameAnnotations = controller.forOccurrence(sameBranch.id);
	applyBranchWorkingCopyText(state.items, main, "renamed main\nbody", "later");
	expect(sameBranch.text).toBe("renamed main\nbody");
	expect(side.text).toBe("a-side title\nbody");
	expect(pinned.text).toBe("a-pinned title\nbody");
	expect(controller.forOccurrence("b")[0].otherDisplayName).toBe("renamed main");
	expect(controller.forOccurrence(sameBranch.id)).toBe(sameAnnotations);
	state.items = state.items.filter((entry) => entry.id !== "a");
	expect(controller.forOccurrence("b")[0].otherDisplayName).toBe("a-pinned title");
});

test("contextual headings mask text changes and equivalent snapshot reloads retain row identities", () => {
	const { state, controller } = setup();
	state.items[0].contextualHeading = " Fixed heading ";
	const b = controller.forOccurrence("b");
	expect(b[0].otherDisplayName).toBe("Fixed heading");
	state.items[0].text = "different title\nbody";
	expect(controller.forOccurrence("b")).toBe(b);
	state.items = state.items.map((entry) => ({ ...entry }));
	state.links = state.links.map((entry) => ({ ...entry }));
	expect(controller.forOccurrence("b")).toBe(b);
	state.items[0].contextualHeading = "";
	expect(controller.forOccurrence("b")[0].otherDisplayName).toBe("different title");
});

test("custom relation direction changes invalidate the appropriate annotations", () => {
	const { state, controller } = setup();
	state.definitions.push({
		name: "CUSTOM",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-10-12",
	});
	state.links[0].type = "CUSTOM";
	const c = controller.forOccurrence("c");
	expect(controller.forOccurrence("a")[0].direction).toBe("outgoing");
	const definition = state.definitions.find((entry) => entry.name === "CUSTOM");
	if (!definition) throw new Error("Missing relation definition");
	definition.direction = "symmetric";
	expect(controller.forOccurrence("a")[0].direction).toBe("symmetric");
	expect(controller.forOccurrence("b")[0].direction).toBe("symmetric");
	expect(controller.forOccurrence("c")).toBe(c);
});
