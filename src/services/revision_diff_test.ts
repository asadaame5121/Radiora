import { assertEquals } from "jsr:@std/assert@1";
import fc from "fast-check";
import type { Revision } from "../domain/models.ts";
import {
	chooseInitialRevisionComparison,
	diffRevisionText,
	type RevisionDiffNode,
} from "./revision_diff.ts";

const lineArbitrary = fc.string({ maxLength: 24 }).filter((line) => !/[\r\n]/.test(line));
const textArbitrary = fc.array(lineArbitrary, { maxLength: 12 }).chain((lines) => {
	if (lines.length === 0) return fc.constant("");
	return fc.array(fc.constantFrom("\n", "\r\n", "\r"), {
		minLength: lines.length - 1,
		maxLength: lines.length - 1,
	}).map((separators) =>
		lines.slice(1).reduce(
			(text, line, index) => `${text}${separators[index]}${line}`,
			lines[0],
		)
	);
});

function normalizeLineEndings(text: string): string {
	return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function assertStrictlyIncreasingLineNumbers(
	nodes: readonly RevisionDiffNode[],
	side: "left" | "right",
): void {
	let previous = 0;
	for (const node of nodes) {
		if (side === "left" && node.kind === "add") continue;
		if (side === "right" && node.kind === "remove") continue;
		const lineNumber = side === "left" ? node.leftLineNumber : node.rightLineNumber;
		assertEquals(typeof lineNumber, "number");
		if (lineNumber === undefined) continue;
		assertEquals(Number.isInteger(lineNumber), true);
		assertEquals(lineNumber > previous, true);
		previous = lineNumber;
	}
}

Deno.test("Revision text diff is stable for identical Japanese text and line ending styles", () => {
	const nodes = diffRevisionText("序章\r\n日本語の本文", "序章\n日本語の本文");

	assertEquals(nodes, [
		{
			kind: "equal",
			text: "序章",
			leftLineNumber: 1,
			rightLineNumber: 1,
		},
		{
			kind: "equal",
			text: "日本語の本文",
			leftLineNumber: 2,
			rightLineNumber: 2,
		},
	]);
});

Deno.test("Revision text diff preserves added and removed blank lines", () => {
	const nodes = diffRevisionText("一行目\n\n旧しい行\n末尾", "一行目\n新しい行\n\n末尾\n");

	assertEquals(nodes.map(({ kind, text }) => ({ kind, text })), [
		{ kind: "equal", text: "一行目" },
		{ kind: "add", text: "新しい行" },
		{ kind: "equal", text: "" },
		{ kind: "remove", text: "旧しい行" },
		{ kind: "equal", text: "末尾" },
		{ kind: "add", text: "" },
	]);
});

Deno.test("Revision text diff deterministically emits a replacement as remove then add", () => {
	const first = diffRevisionText("同じ\n左だけ\n同じ", "同じ\n右だけ\n同じ");
	const second = diffRevisionText("同じ\n左だけ\n同じ", "同じ\n右だけ\n同じ");

	assertEquals(first, second);
	assertEquals(first.map(({ kind, text }) => ({ kind, text })), [
		{ kind: "equal", text: "同じ" },
		{ kind: "remove", text: "左だけ" },
		{ kind: "add", text: "右だけ" },
		{ kind: "equal", text: "同じ" },
	]);
});

Deno.test("Revision text diff represents empty and newly populated bodies", () => {
	assertEquals(diffRevisionText("", ""), []);
	assertEquals(
		diffRevisionText("", "新しい本文"),
		[{ kind: "add", text: "新しい本文", rightLineNumber: 1 }],
	);
	assertEquals(
		diffRevisionText("削除する本文", ""),
		[{ kind: "remove", text: "削除する本文", leftLineNumber: 1 }],
	);
});

Deno.test("Property: revision diff reconstructs both normalized source texts", () => {
	void fc.assert(
		fc.property(textArbitrary, textArbitrary, (left, right) => {
			const nodes = diffRevisionText(left, right);
			const reconstructedLeft = nodes
				.filter(({ kind }) => kind !== "add")
				.map(({ text }) => text)
				.join("\n");
			const reconstructedRight = nodes
				.filter(({ kind }) => kind !== "remove")
				.map(({ text }) => text)
				.join("\n");

			assertEquals(reconstructedLeft, normalizeLineEndings(left));
			assertEquals(reconstructedRight, normalizeLineEndings(right));
			assertStrictlyIncreasingLineNumbers(nodes, "left");
			assertStrictlyIncreasingLineNumbers(nodes, "right");
		}),
		{ numRuns: 100 },
	);
});

Deno.test("comparison defaults to the selected version and its first available parent", () => {
	const revisions: Revision[] = [
		{
			id: "parent",
			workId: "work",
			text: "親",
			parentRevisionIds: [],
			kind: "edition",
			createdAt: "2026-07-28T00:00:00.000Z",
		},
		{
			id: "other-parent",
			workId: "work",
			text: "別の親",
			parentRevisionIds: [],
			kind: "edition",
			createdAt: "2026-07-28T01:00:00.000Z",
		},
		{
			id: "selected",
			workId: "work",
			text: "選択版",
			parentRevisionIds: ["parent", "other-parent"],
			kind: "merge",
			createdAt: "2026-07-28T02:00:00.000Z",
		},
	];

	assertEquals(chooseInitialRevisionComparison(revisions, "selected"), {
		leftRevisionId: "parent",
		rightRevisionId: "selected",
	});
	assertEquals(chooseInitialRevisionComparison(revisions.slice(0, 1)), null);
});
