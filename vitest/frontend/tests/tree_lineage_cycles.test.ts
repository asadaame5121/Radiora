import { expect, test } from "vitest";
import { findCyclicWorkIds } from "../../../src/ui/tree_lineage_cycles.ts";

test("lineage cycles isolate SCC members and self-links, not incoming or outgoing trees", () => {
	const children = new Map([
		["root", new Set(["a"])],
		["a", new Set(["b"])],
		["b", new Set(["a", "tail"])],
		["tail", new Set(["leaf"])],
		["leaf", new Set<string>()],
		["self", new Set(["self"])],
		["isolated", new Set<string>()],
	]);
	expect([...findCyclicWorkIds([...children.keys()], children)].sort()).toEqual(["a", "b", "self"]);
	expect([...findCyclicWorkIds([...children.keys()].reverse(), children)].sort()).toEqual([
		"a",
		"b",
		"self",
	]);
});

test("lineage cycles do not mark convergent DAG paths as cycles", () => {
	const children = new Map([
		["root", new Set(["a", "b"])],
		["a", new Set(["tail"])],
		["b", new Set(["tail"])],
		["tail", new Set<string>()],
	]);
	expect(findCyclicWorkIds([...children.keys()], children)).toEqual(new Set());
	expect(findCyclicWorkIds([], new Map())).toEqual(new Set());
});
