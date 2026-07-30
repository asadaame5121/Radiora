import { assert, assertEquals, assertLess } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineLink, SearchReason, SearchResult } from "../src/domain/models.ts";
import { buildSparseOutline } from "../src/services/sparse_outline.ts";

const NOW = "2026-07-30T00:00:00.000Z";
const WORK_COUNT = 3_000;
const MATCH_COUNT = 500;
const LINK_COUNT = 24_000;

function makeItem(id: string, parentId: string | null = null): OutlineItem {
	return {
		id,
		workId: `work-${id}`,
		text: id,
		parentId,
		orderKey: 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function makeLink(id: string, from: OutlineItem, to: OutlineItem): OutlineLink {
	return {
		id,
		fromId: from.workId,
		toId: to.workId,
		from: { scope: "work", workId: from.workId },
		to: { scope: "work", workId: to.workId },
		type: "RELATED",
		status: "asserted",
		origin: "human",
		createdAt: NOW,
	};
}

function fixture(): { items: OutlineItem[]; links: OutlineLink[]; results: SearchResult[] } {
	const roots = Array.from({ length: 10 }, (_, index) => makeItem(`root-${index}`));
	const groups = Array.from(
		{ length: 50 },
		(_, index) => makeItem(`group-${index}`, roots[Math.floor(index / 5)].id),
	);
	const matches = Array.from(
		{ length: MATCH_COUNT },
		(_, index) => makeItem(`match-${index}`, groups[Math.floor(index / 10)].id),
	);
	const directTargets = Array.from(
		{ length: MATCH_COUNT },
		(_, index) => makeItem(`direct-${index}`),
	);
	const fillers = Array.from({
		length: WORK_COUNT - roots.length - groups.length - matches.length - directTargets.length,
	}, (
		_,
		index,
	) => makeItem(`filler-${index}`));
	const items = [...roots, ...groups, ...matches, ...directTargets, ...fillers];
	const reasons: SearchReason[] = [
		{ kind: "title", label: "タイトル一致", score: 3 },
		{ kind: "body", label: "本文一致", score: 2 },
		{ kind: "direct-link", label: "選択中の思索と直接接続", score: 1 },
		{ kind: "shared-link", label: "共通リンク 2件", score: 0.5 },
		{ kind: "shared-ancestor", label: "共通の祖先", score: 0.5 },
	];
	const results = matches.map((item, index) => ({
		item,
		ancestorIds: [roots[Math.floor(index / 50)].id, groups[Math.floor(index / 10)].id],
		score: 1 - index / (MATCH_COUNT * 2),
		reasons: [reasons[index % reasons.length]],
	}));
	const nonMatches = [...roots, ...groups, ...directTargets, ...fillers];
	const links = matches.map((item, index) =>
		makeLink(`direct-link-${index}`, item, directTargets[index])
	);
	for (let index = links.length; index < LINK_COUNT; index++) {
		const from = nonMatches[index % nonMatches.length];
		const to = nonMatches[(index * 17 + 1) % nonMatches.length];
		links.push(makeLink(`dense-link-${index}`, from, to));
	}
	return { items, links, results };
}

Deno.test("sparse outline preserves dense search context within its performance budget", () => {
	const { items, links, results } = fixture();
	assertEquals(items.length, WORK_COUNT);
	assertEquals(links.length, LINK_COUNT);

	const itemsBefore = structuredClone(items);
	const linksBefore = structuredClone(links);
	const resultsBefore = structuredClone(results);
	const started = performance.now();
	const nodes = buildSparseOutline(results, items, links);
	const elapsedMs = performance.now() - started;

	assertLess(elapsedMs, 2_500, `Sparse Outline took ${elapsedMs.toFixed(1)}ms`);
	assertEquals(items, itemsBefore);
	assertEquals(links, linksBefore);
	assertEquals(results, resultsBefore);

	const nodeByOccurrenceId = new Map(
		nodes.map((node, index) => [node.occurrenceId, { node, index }]),
	);
	for (const result of results) {
		const found = nodeByOccurrenceId.get(result.item.id);
		assert(found, `missing matched occurrence ${result.item.id}`);
		assertEquals(found.node.workId, result.item.workId);
		assertEquals(found.node.occurrenceId, result.item.id);
		assertEquals(found.node.score, result.score);
		assertEquals(found.node.reasons, result.reasons);
		assertEquals(found.node.breadcrumb, result.ancestorIds);

		const [rootId, groupId] = result.ancestorIds;
		const root = nodeByOccurrenceId.get(rootId);
		const group = nodeByOccurrenceId.get(groupId);
		assert(root, `missing root ancestor ${rootId}`);
		assert(group, `missing group ancestor ${groupId}`);
		assertEquals(group.node.parentNodeIndex, root.index);
		assertEquals(found.node.parentNodeIndex, group.index);

		const directTargetId = result.item.id.replace("match-", "direct-");
		const directTarget = nodeByOccurrenceId.get(directTargetId);
		assert(directTarget, `missing direct link target ${directTargetId}`);
		assertEquals(directTarget.node.parentNodeIndex, found.index);
		assertEquals(directTarget.node.reasons, undefined);
		assertEquals(directTarget.node.score, undefined);
	}

	for (const root of items.filter((item) => item.id.startsWith("root-"))) {
		assertEquals(nodes.filter((node) => node.occurrenceId === root.id).length, 1);
	}
	for (const group of items.filter((item) => item.id.startsWith("group-"))) {
		assertEquals(nodes.filter((node) => node.occurrenceId === group.id).length, 1);
	}
});
