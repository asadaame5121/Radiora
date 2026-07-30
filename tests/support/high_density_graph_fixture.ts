import type {
	Branch,
	Occurrence,
	OutlineItem,
	OutlineLink,
	SearchReason,
	SearchResult,
	Work,
	WorkingCopy,
} from "../../src/domain/models.ts";
import { MemoryGraphStore } from "../../src/storage/memory_store.ts";
import { OutlineService } from "../../src/services/outline_service.ts";

export const HIGH_DENSITY_NOW = "2026-07-30T00:00:00.000Z";
export const HIGH_DENSITY_WORK_COUNT = 3_000;
export const HIGH_DENSITY_MATCH_COUNT = 500;
export const HIGH_DENSITY_LINK_COUNT = 24_000;
export const HIGH_DENSITY_SEARCH_QUERY = "high density search";

export interface HighDensityGraphFixture {
	store: MemoryGraphStore;
	service: OutlineService;
	items: OutlineItem[];
	links: OutlineLink[];
	roots: OutlineItem[];
	groups: OutlineItem[];
	matches: OutlineItem[];
	directTargets: OutlineItem[];
	projectionResults: SearchResult[];
	searchContext: OutlineItem;
}

export async function createHighDensityGraphFixture(): Promise<HighDensityGraphFixture> {
	const roots = Array.from({ length: 10 }, (_, index) => makeItem(`root-${index}`, null, "root"));
	const groups = Array.from(
		{ length: 50 },
		(_, index) => makeItem(`group-${index}`, roots[Math.floor(index / 5)].id, "group"),
	);
	const matches = Array.from(
		{ length: HIGH_DENSITY_MATCH_COUNT },
		(_, index) =>
			makeItem(
				`match-${index}`,
				groups[Math.floor(index / 10)].id,
				`${HIGH_DENSITY_SEARCH_QUERY} match ${index}`,
			),
	);
	const directTargets = Array.from(
		{ length: HIGH_DENSITY_MATCH_COUNT },
		(_, index) => makeItem(`direct-${index}`, null, "direct target"),
	);
	const fillers = Array.from(
		{
			length: HIGH_DENSITY_WORK_COUNT - roots.length - groups.length - matches.length -
				directTargets.length,
		},
		(_, index) => makeItem(`filler-${index}`, null, "filler"),
	);
	const items = [...roots, ...groups, ...matches, ...directTargets, ...fillers];
	const searchContext = roots[0];
	const reasons: SearchReason[] = [
		{ kind: "title", label: "タイトル一致", score: 3 },
		{ kind: "body", label: "本文一致", score: 2 },
		{ kind: "direct-link", label: "選択中の思索と直接接続", score: 1 },
		{ kind: "shared-link", label: "共通リンク 2件", score: 0.5 },
		{ kind: "shared-ancestor", label: "共通の祖先", score: 0.5 },
	];
	const projectionResults = matches.map((item, index) => ({
		item,
		ancestorIds: [roots[Math.floor(index / 50)].id, groups[Math.floor(index / 10)].id],
		score: 1 - index / (HIGH_DENSITY_MATCH_COUNT * 2),
		reasons: [reasons[index % reasons.length]],
	}));
	const nonMatches = [...roots, ...groups, ...directTargets, ...fillers];
	const links = matches.flatMap((item, index) => [
		makeLink(`context-link-${index}`, searchContext, item),
		makeLink(`direct-link-${index}`, item, directTargets[index]),
	]);
	for (let index = links.length; index < HIGH_DENSITY_LINK_COUNT; index++) {
		const from = nonMatches[index % nonMatches.length];
		const to = nonMatches[(index * 17 + 1) % nonMatches.length];
		links.push(makeLink(`dense-link-${index}`, from, to));
	}

	const store = new MemoryGraphStore();
	for (const item of items) {
		await store.createWorkBundle(...workBundle(item));
	}
	for (const link of links) await store.createLink(link);
	return {
		store,
		service: new OutlineService(store),
		items,
		links,
		roots,
		groups,
		matches,
		directTargets,
		projectionResults,
		searchContext,
	};
}

function makeItem(id: string, parentId: string | null, text: string): OutlineItem {
	return {
		id,
		workId: `work-${id}`,
		text,
		parentId,
		orderKey: 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: HIGH_DENSITY_NOW,
		updatedAt: HIGH_DENSITY_NOW,
	};
}

function workBundle(item: OutlineItem): [Work, Branch, WorkingCopy, Occurrence] {
	const branchId = item.revisionSelector.mode === "branch" ? item.revisionSelector.branchId : "";
	return [
		{ id: item.workId, createdAt: item.createdAt, updatedAt: item.updatedAt },
		{
			id: branchId,
			workId: item.workId,
			name: "main",
			headRevisionId: null,
			createdAt: item.createdAt,
		},
		{ branchId, workId: item.workId, text: item.text, updatedAt: item.updatedAt },
		{
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: item.parentId,
			orderKey: item.orderKey,
			collapsed: item.collapsed,
			revisionSelector: item.revisionSelector,
		},
	];
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
		createdAt: HIGH_DENSITY_NOW,
	};
}
