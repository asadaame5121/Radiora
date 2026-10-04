import { assertEquals } from "jsr:@std/assert@1";
import { findCyclicWorkIds } from "../src/ui/tree_lineage_cycles.ts";

Deno.test("lineage cycles isolate SCC members and self-links, not incoming or outgoing trees", () => {
	const children = new Map([
		["root", new Set(["a"])],
		["a", new Set(["b"])],
		["b", new Set(["a", "tail"])],
		["tail", new Set(["leaf"])],
		["leaf", new Set<string>()],
		["self", new Set(["self"])],
		["isolated", new Set<string>()],
	]);
	assertEquals([...findCyclicWorkIds([...children.keys()], children)].sort(), ["a", "b", "self"]);
	assertEquals([...findCyclicWorkIds([...children.keys()].reverse(), children)].sort(), [
		"a",
		"b",
		"self",
	]);
});

Deno.test("lineage cycles do not mark convergent DAG paths as cycles", () => {
	const children = new Map([
		["root", new Set(["a", "b"])],
		["a", new Set(["tail"])],
		["b", new Set(["tail"])],
		["tail", new Set<string>()],
	]);
	assertEquals(findCyclicWorkIds([...children.keys()], children), new Set());
	assertEquals(findCyclicWorkIds([], new Map()), new Set());
});
