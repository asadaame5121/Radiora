import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import fc from "fast-check";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import { type OpmlNode, parseOpml, renderOutlineSnapshotOpml } from "./opml.ts";

function item(
	id: string,
	text: string,
	parentId: string | null,
	orderKey: number,
): OutlineItem {
	return {
		id,
		workId: `work-${id}`,
		text,
		parentId,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

function snapshot(items: OutlineItem[]): OutlineSnapshot {
	return { items, links: [], knots: [], stashItemIds: [] };
}

interface GeneratedItem {
	readonly text: string;
	readonly parentHint: number;
}

const generatedItemsArbitrary = fc.array(
	fc.record({
		text: fc.string({ maxLength: 40 }),
		parentHint: fc.nat(),
	}),
	{ minLength: 2, maxLength: 12 },
);

function generatedParentIndex(entry: GeneratedItem, index: number): number | null {
	if (index < 2 || entry.parentHint % (index + 1) === index) return null;
	return entry.parentHint % index;
}

function generatedSnapshot(generated: readonly GeneratedItem[]): OutlineSnapshot {
	const nextSiblingOrder = new Map<number | null, number>();
	const items = generated.map((entry, index) => {
		const parentIndex = generatedParentIndex(entry, index);
		const orderKey = nextSiblingOrder.get(parentIndex) ?? 0;
		nextSiblingOrder.set(parentIndex, orderKey + 1);
		return item(
			"item-" + index,
			entry.text,
			parentIndex === null ? null : "item-" + parentIndex,
			orderKey,
		);
	});
	return snapshot(items.toReversed());
}

function expectedTree(generated: readonly GeneratedItem[]): OpmlNode[] {
	const childrenByParent = new Map<number | null, number[]>();
	for (const [index, entry] of generated.entries()) {
		const parentIndex = generatedParentIndex(entry, index);
		const children = childrenByParent.get(parentIndex) ?? [];
		children.push(index);
		childrenByParent.set(parentIndex, children);
	}
	const toNode = (index: number): OpmlNode => ({
		text: generated[index].text,
		children: (childrenByParent.get(index) ?? []).map(toNode),
	});
	return (childrenByParent.get(null) ?? []).map(toNode);
}

Deno.test("OPML round-trip retains hierarchy, sibling order, Japanese, and complete multiline text", () => {
	const opml = renderOutlineSnapshotOpml(snapshot([
		item("later", "後の兄弟", null, 2),
		item("child-b", "子B\n二行目", "root", 2),
		item("root", "序章 & <導入>\n\n複数行の本文\n最後", null, 1),
		item("child-a", "子A\n日本語の本文", "root", 1),
	]));
	assertEquals(parseOpml(opml), [
		{
			text: "序章 & <導入>\n\n複数行の本文\n最後",
			children: [
				{ text: "子A\n日本語の本文", children: [] },
				{ text: "子B\n二行目", children: [] },
			],
		},
		{ text: "後の兄弟", children: [] },
	]);
});

Deno.test("OPML export includes standard text and note fields alongside lossless Radiora data", () => {
	const opml = renderOutlineSnapshotOpml(snapshot([item("root", "題\n本文", null, 0)]));
	assertEquals(opml.includes('text="題"'), true);
	assertEquals(opml.includes('_note="本文"'), true);
	assertEquals(opml.includes('data-radiora-text="'), true);
});

Deno.test("external OPML combines text and note and decodes numeric XML entities", () => {
	assertEquals(
		parseOpml([
			'<opml version="2.0">',
			"<head/>",
			'<body><outline text="&#26085;&#26412;&#35486; &amp; &#x8A18;&#21495;" _note="1行目&#10;2行目"/></body>',
			"</opml>",
		].join("")),
		[{ text: "日本語 & 記号\n1行目\n2行目", children: [] }],
	);
});

Deno.test("OPML rejects entity declarations and malformed or incomplete XML", () => {
	for (
		const source of [
			'<!DOCTYPE opml [<!ENTITY unsafe "x">]><opml><body/></opml>',
			'<opml><body><outline text="broken"></body></opml>',
			"<opml><head/></opml>",
		]
	) {
		assertThrows(() => parseOpml(source));
	}
});

Deno.test("OPML rejects malformed Radiora lossless attributes", () => {
	assertThrows(() =>
		parseOpml(
			'<opml><body><outline text="x" data-radiora-text="not base64!"/></body></opml>',
		)
	);
});

Deno.test(
	"Property: OPML round-trip preserves generated text, hierarchy, and sibling order",
	() => {
		void fc.assert(
			fc.property(generatedItemsArbitrary, (generated) => {
				assertEquals(
					parseOpml(renderOutlineSnapshotOpml(generatedSnapshot(generated))),
					expectedTree(generated),
				);
			}),
			{ numRuns: 100 },
		);
	},
);
