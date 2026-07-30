import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import {
	renderOutlineSnapshotMarkdown,
	rewriteMarkdownExportReferences,
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
): OutlineSnapshot => ({ items, links: [], knots: [], stashItemIds });

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
