import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineLink, OutlineSnapshot } from "../domain/models.ts";
import {
	renderOutlineSnapshotMarkdown,
	rewriteMarkdownExportReferences,
	selectMarkdownExportSnapshot,
} from "./markdown_export.ts";
import { parseMarkdownCandidates } from "./markdown_parser.ts";

const item = (
	id: string,
	text: string,
	parentId: string | null,
	orderKey: number,
	contextualHeading?: string,
): OutlineItem => ({
	id,
	workId: `work-${id}`,
	text,
	parentId,
	orderKey,
	collapsed: false,
	revisionSelector: { mode: "branch", branchId: `branch-${id}` },
	contextualHeading,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
});

const snapshot = (
	items: OutlineItem[],
	stashItemIds: string[] = [],
	links: OutlineLink[] = [],
): OutlineSnapshot => ({ items, links, knots: [], stashItemIds });

const link = (
	id: string,
	fromWorkId: string,
	toWorkId: string,
	status: OutlineLink["status"] = "asserted",
): OutlineLink => ({
	id,
	fromId: `legacy-${id}-from`,
	toId: `legacy-${id}-to`,
	from: { scope: "work", workId: fromWorkId },
	to: { scope: "work", workId: toWorkId },
	type: "RELATED",
	status,
	origin: "human",
	createdAt: "2026-01-01T00:00:00.000Z",
});

const selection = (
	selectedOccurrenceId: string | null,
	overrides: Partial<Parameters<typeof selectMarkdownExportSnapshot>[1]> = {},
): Parameters<typeof selectMarkdownExportSnapshot>[1] => ({
	scope: "selected",
	selectedOccurrenceId,
	includeAncestors: false,
	includeDescendants: false,
	includeSemanticNeighbors: false,
	...overrides,
});

Deno.test("Markdown export selection keeps the all scope backward compatible", () => {
	const source = snapshot([item("root", "Root", null, 0)], ["root"]);
	const selected = selectMarkdownExportSnapshot(source, {
		...selection(null),
		scope: "all",
	});
	assertEquals(selected, source);
	assertEquals(selected === source, false);
	assertEquals(selected.items === source.items, false);
});

Deno.test("selected scope can include only the selected placement", () => {
	const selected = selectMarkdownExportSnapshot(
		snapshot([
			item("root", "Root", null, 0),
			item("selected", "Selected", "root", 0),
			item("child", "Child", "selected", 0),
		]),
		selection("selected"),
	);
	assertEquals(selected.items.map((entry) => entry.id), ["selected"]);
	assertEquals(renderOutlineSnapshotMarkdown(selected), "# Selected\n");
});

Deno.test("selected scope expands ancestors and descendants independently", () => {
	const source = snapshot([
		item("root", "Root", null, 0),
		item("parent", "Parent", "root", 0),
		item("selected", "Selected", "parent", 0),
		item("child", "Child", "selected", 0),
		item("grandchild", "Grandchild", "child", 0),
		item("sibling", "Sibling", "parent", 1),
	]);
	assertEquals(
		selectMarkdownExportSnapshot(source, selection("selected", { includeAncestors: true }))
			.items.map((entry) => entry.id),
		["root", "parent", "selected"],
	);
	assertEquals(
		selectMarkdownExportSnapshot(source, selection("selected", { includeDescendants: true }))
			.items.map((entry) => entry.id),
		["selected", "child", "grandchild"],
	);
	assertEquals(
		selectMarkdownExportSnapshot(
			source,
			selection("selected", {
				includeAncestors: true,
				includeDescendants: true,
			}),
		).items.map((entry) => entry.id),
		["root", "parent", "selected", "child", "grandchild"],
	);
});

Deno.test("semantic expansion is direct, bidirectional, active, and includes every occurrence", () => {
	const source = snapshot(
		[
			item("selected", "Selected", null, 0),
			{ ...item("neighbor-b", "Neighbor B", null, 2), workId: "neighbor" },
			{ ...item("neighbor-a", "Neighbor A", null, 1), workId: "neighbor" },
			{ ...item("incoming", "Incoming", null, 3), workId: "incoming-work" },
			{ ...item("second-hop", "Second hop", null, 4), workId: "second-hop-work" },
			{ ...item("retracted", "Retracted", null, 5), workId: "retracted-work" },
		],
		[],
		[
			link("outgoing", "work-selected", "neighbor"),
			link("incoming", "incoming-work", "work-selected", "provisional"),
			link("second-hop", "neighbor", "second-hop-work"),
			link("retracted", "work-selected", "retracted-work", "retracted"),
		],
	);
	const selected = selectMarkdownExportSnapshot(
		source,
		selection("selected", { includeSemanticNeighbors: true }),
	);
	assertEquals(selected.items.map((entry) => entry.id), [
		"selected",
		"neighbor-b",
		"neighbor-a",
		"incoming",
	]);
	assertEquals(
		renderOutlineSnapshotMarkdown(selected),
		"# Selected\n\n# Neighbor A\n\n# Neighbor B\n\n# Incoming\n",
	);
});

Deno.test("semantic placements do not inherit outline expansion", () => {
	const source = snapshot(
		[
			item("selected", "Selected", null, 0),
			{ ...item("neighbor-parent", "Neighbor parent", null, 0), workId: "parent-work" },
			{ ...item("neighbor", "Neighbor", "neighbor-parent", 0), workId: "neighbor-work" },
			{ ...item("neighbor-child", "Neighbor child", "neighbor", 0), workId: "child-work" },
		],
		[],
		[link("semantic", "work-selected", "neighbor-work")],
	);
	assertEquals(
		selectMarkdownExportSnapshot(
			source,
			selection("selected", {
				includeAncestors: true,
				includeDescendants: true,
				includeSemanticNeighbors: true,
			}),
		).items.map((entry) => entry.id),
		["selected", "neighbor"],
	);
});

Deno.test("selection rejects absent selections and tolerates malformed outline relations", () => {
	const source = snapshot([
		item("cycle-a", "Cycle A", "cycle-b", 0),
		item("cycle-b", "Cycle B", "cycle-a", 0),
		item("orphan", "Orphan", "missing", 0),
		item("duplicate", "Duplicate first", null, 0),
		item("duplicate", "Duplicate second", null, 1),
	]);
	assertThrows(() => selectMarkdownExportSnapshot(source, selection(null)), RangeError);
	assertThrows(() => selectMarkdownExportSnapshot(source, selection("missing")), RangeError);
	assertEquals(
		selectMarkdownExportSnapshot(source, selection("cycle-a", { includeAncestors: true }))
			.items.map((entry) => entry.id),
		["cycle-a", "cycle-b"],
	);
	assertEquals(
		selectMarkdownExportSnapshot(source, selection("orphan", { includeAncestors: true }))
			.items.map((entry) => entry.id),
		["orphan"],
	);
	assertEquals(
		selectMarkdownExportSnapshot(source, selection("duplicate")).items.length,
		1,
	);
});

Deno.test("Markdown export selection does not mutate its input", () => {
	const source = snapshot(
		[
			item("root", "Root", null, 0),
			item("selected", "Selected", "root", 0),
		],
		["selected"],
		[link("self", "work-selected", "work-selected")],
	);
	const before = structuredClone(source);
	selectMarkdownExportSnapshot(
		source,
		selection("selected", {
			includeAncestors: true,
			includeSemanticNeighbors: true,
		}),
	);
	assertEquals(source, before);
});

Deno.test("Markdown export follows stable parent and orderKey hierarchy", () => {
	const markdown = renderOutlineSnapshotMarkdown(snapshot([
		item("later", "Later\nlater body", null, 2),
		item("child-b", "Child B", "root", 2),
		item("root", "Root\nroot body", null, 1),
		item("child-a", "Child A\nchild body", "root", 1),
	]));
	assertEquals(
		markdown,
		[
			"# Root",
			"",
			"root body",
			"",
			"## Child A",
			"",
			"child body",
			"",
			"## Child B",
			"",
			"# Later",
			"",
			"later body",
			"",
		].join("\n"),
	);
});

Deno.test("contextual heading is preferred without dropping any original text", () => {
	const markdown = renderOutlineSnapshotMarkdown(snapshot([
		item(
			"occurrence",
			"\nOriginal first line\nradiora://work/work-2\nLast line",
			null,
			0,
			"Placement heading",
		),
	]));
	assertEquals(
		markdown,
		"# Placement heading\n\n\nOriginal first line\nradiora://work/work-2\nLast line\n",
	);
});

Deno.test("depth beyond Markdown heading level six remains explicit", () => {
	const items = Array.from(
		{ length: 8 },
		(_, index) =>
			item(`item-${index}`, `Level ${index + 1}`, index ? `item-${index - 1}` : null, 0),
	);
	const markdown = renderOutlineSnapshotMarkdown(snapshot(items));
	assertStringIncludes(markdown, "###### Level 6");
	assertStringIncludes(markdown, "###### ↳ 深さ 7: Level 7");
	assertStringIncludes(markdown, "###### ↳ 深さ 8: Level 8");
});

Deno.test("cycles, orphans, duplicate IDs, and stash placements are all exported once", () => {
	const markdown = renderOutlineSnapshotMarkdown(snapshot([
		item("cycle-a", "Cycle A", "cycle-b", 2),
		item("cycle-b", "Cycle B", "cycle-a", 1),
		item("orphan", "Orphan", "missing", 0),
		item("duplicate", "Duplicate first", null, 4),
		item("duplicate", "Duplicate second", null, 5),
		item("stash", "Stashed\nkept", null, 3),
	], ["cycle-a", "stash"]));
	for (
		const content of [
			"Cycle A",
			"Cycle B",
			"Orphan",
			"Duplicate first",
			"Duplicate second",
			"Stashed",
			"kept",
		]
	) {
		assertEquals(markdown.split(content).length - 1, 1);
	}
	assertStringIncludes(markdown, "[Stash] Cycle A");
	assertStringIncludes(markdown, "[Stash] Stashed");
});

Deno.test("empty snapshots export an empty document", () => {
	assertEquals(renderOutlineSnapshotMarkdown(snapshot([])), "");
});

Deno.test("Markdown export reference modes preserve IDs or intentionally remove them", () => {
	const markdown = [
		"本文 [項目](radiora://work/work-1) と [初稿](radiora://revision/revision-1#節)",
		"`[code](radiora://work/code)`",
		"```md",
		"[fenced](radiora://work/fenced)",
		"```",
	].join("\n");

	assertEquals(rewriteMarkdownExportReferences(markdown, "radiora"), markdown);
	assertEquals(
		rewriteMarkdownExportReferences(markdown, "portable"),
		[
			"本文 項目 と 初稿",
			"`[code](radiora://work/code)`",
			"```md",
			"[fenced](radiora://work/fenced)",
			"```",
		].join("\n"),
	);
});

Deno.test("Obsidian export rewrites only resolved references and preserves unresolved IDs", () => {
	const markdown =
		"[旧表示](radiora://work/work-1) [未解決](radiora://revision/missing) [別項目](radiora://work/work-2)";
	const [resolved, missing, deleted] = parseMarkdownCandidates(markdown).internalReferences;
	const exported = rewriteMarkdownExportReferences(markdown, "obsidian", [
		{
			reference: resolved,
			status: "resolved",
			displayName: "現在の]表示|名",
			workId: "work-1",
		},
		{ reference: missing, status: "missing" },
		{ reference: deleted, status: "deleted" },
	]);

	assertEquals(
		exported,
		"[[現在の\\]表示\\|名]] [未解決](radiora://revision/missing) [別項目](radiora://work/work-2)",
	);
});

Deno.test("portable export rewrites multiple escaped canonical labels without range drift", () => {
	const markdown =
		"[表示 \\[一\\]](radiora://work/work-1) / [A \\\\ B](radiora://revision/revision-1)";
	assertEquals(
		rewriteMarkdownExportReferences(markdown, "portable"),
		"表示 \\[一\\] / A \\\\ B",
	);
});
