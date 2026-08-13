import type {
	LinkType,
	OutlineItem,
	RelationTypeDirection,
	SearchAlias,
	Work,
} from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	WorkStorePort,
} from "../storage/graph_store.ts";
import { parseAdvancedLinkInput } from "./advanced_link_parser.ts";
import { normalizeSearchText, titleFromText } from "./search_text.ts";

export type AdvancedLinkMatchKind = "exact" | "alias" | "short-id" | "selected";
export type AdvancedLinkResolutionStatus = "resolved" | "ambiguous" | "unresolved";

type AdvancedLinkStore = OutlineStorePort & WorkStorePort & DiscoveryStorePort;

export interface AdvancedLinkPlacement {
	occurrenceId: string;
	breadcrumb: string[];
}

export interface AdvancedLinkCandidate {
	workId: string;
	displayName: string;
	shortId: string;
	updatedAt: string;
	unplaced: boolean;
	placements: AdvancedLinkPlacement[];
	matchKind: AdvancedLinkMatchKind;
}

export interface AdvancedLinkEndpointResolution {
	query: string;
	status: AdvancedLinkResolutionStatus;
	reason?: string;
	selectedWorkId?: string;
	candidates: AdvancedLinkCandidate[];
}

export interface AdvancedLinkResolution {
	source: AdvancedLinkEndpointResolution;
	type: { status: "resolved"; value: LinkType };
	target: AdvancedLinkEndpointResolution;
	preview?: string;
	reason?: string;
}

export interface AdvancedLinkSelections {
	sourceWorkId?: string;
	targetWorkId?: string;
}

interface ActiveWorkView {
	work: Work;
	displayName: string;
	placements: AdvancedLinkPlacement[];
}

/**
 * Resolves Advanced Link text without mutating graph state.
 *
 * Explicit selections are immutable Work tokens. Once the user chooses a candidate,
 * a later Working Copy rename does not redirect that token to another Work.
 */
export class AdvancedLinkResolverService {
	constructor(private readonly store: AdvancedLinkStore) {}

	async resolve(
		input: string,
		selections: AdvancedLinkSelections = {},
	): Promise<AdvancedLinkResolution> {
		const parsed = parseAdvancedLinkInput(input);
		const [works, items, branches, workingCopies, aliases] = await Promise.all([
			this.store.listWorks(),
			this.store.listItems(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listAliases(),
		]);
		const active = activeWorkViews(works, items, branches, workingCopies);
		const source = resolveEndpoint(parsed.source, selections.sourceWorkId, active, aliases);
		const target = resolveEndpoint(parsed.target, selections.targetWorkId, active, aliases);
		return {
			source,
			type: { status: "resolved", value: parsed.type },
			target,
			reason: parsed.reason,
			...(source.status === "resolved" && target.status === "resolved"
				? {
					preview: previewDirection(
						source.candidates[0].displayName,
						parsed.type,
						target.candidates[0].displayName,
					),
				}
				: {}),
		};
	}
}

function activeWorkViews(
	works: readonly Work[],
	items: readonly OutlineItem[],
	branches: Awaited<ReturnType<WorkStorePort["listBranches"]>>,
	workingCopies: Awaited<ReturnType<WorkStorePort["listWorkingCopies"]>>,
): ActiveWorkView[] {
	const itemById = new Map(items.map((item) => [item.id, item]));
	const itemsByWork = new Map<string, OutlineItem[]>();
	for (const item of items) {
		const placements = itemsByWork.get(item.workId) ?? [];
		placements.push(item);
		itemsByWork.set(item.workId, placements);
	}
	const copyByBranch = new Map(workingCopies.map((copy) => [copy.branchId, copy]));
	return works.map((work) => {
		const main = branches.find((branch) =>
			branch.workId === work.id && branch.name === "main" && !branch.archivedAt
		);
		const displayName = titleFromText(main ? copyByBranch.get(main.id)?.text ?? "" : "");
		const placements = (itemsByWork.get(work.id) ?? [])
			.map((item) => ({
				occurrenceId: item.id,
				breadcrumb: breadcrumbFor(item, itemById),
			}))
			.sort((left, right) =>
				left.breadcrumb.join("\u0000").localeCompare(right.breadcrumb.join("\u0000")) ||
				left.occurrenceId.localeCompare(right.occurrenceId)
			);
		return { work, displayName, placements };
	});
}

function breadcrumbFor(
	item: OutlineItem,
	itemById: ReadonlyMap<string, OutlineItem>,
): string[] {
	const result: string[] = [];
	const visited = new Set<string>([item.id]);
	let current = item.parentId ? itemById.get(item.parentId) : undefined;
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		result.unshift(current.contextualHeading?.trim() || titleFromText(current.text) || "(無題)");
		current = current.parentId ? itemById.get(current.parentId) : undefined;
	}
	result.push(item.contextualHeading?.trim() || titleFromText(item.text) || "(無題)");
	return result;
}

function resolveEndpoint(
	query: string,
	selectedWorkId: string | undefined,
	active: readonly ActiveWorkView[],
	aliases: readonly SearchAlias[],
): AdvancedLinkEndpointResolution {
	if (selectedWorkId) {
		const selected = active.find((candidate) => candidate.work.id === selectedWorkId);
		if (selected) {
			return {
				query,
				status: "resolved",
				selectedWorkId,
				candidates: [toCandidate(selected, "selected")],
			};
		}
		return {
			query,
			status: "unresolved",
			reason: "選択済みの項目は現在利用できません。",
			candidates: [],
		};
	}

	const normalized = normalizeSearchText(query);
	const equivalentNames = aliasEquivalents(normalized, aliases);
	const matches = active.flatMap((candidate): AdvancedLinkCandidate[] => {
		const title = normalizeSearchText(candidate.displayName);
		if (title === normalized) return [toCandidate(candidate, "exact")];
		if (equivalentNames.has(title)) return [toCandidate(candidate, "alias")];
		if (normalizeSearchText(candidate.work.id.slice(0, 8)) === normalized) {
			return [toCandidate(candidate, "short-id")];
		}
		return [];
	}).sort((left, right) =>
		left.displayName.localeCompare(right.displayName) || left.workId.localeCompare(right.workId)
	);
	if (matches.length === 1) {
		return { query, status: "resolved", selectedWorkId: matches[0].workId, candidates: matches };
	}
	if (matches.length > 1) {
		return {
			query,
			status: "ambiguous",
			reason: "同名または同じ別名の候補が複数あります。項目を選択してください。",
			candidates: matches,
		};
	}
	return {
		query,
		status: "unresolved",
		reason: "一致する有効な項目がありません。",
		candidates: [],
	};
}

function aliasEquivalents(query: string, aliases: readonly SearchAlias[]): Set<string> {
	const result = new Set<string>();
	for (const alias of aliases) {
		const terms = [alias.canonical, ...alias.variants].map(normalizeSearchText);
		if (!terms.includes(query)) continue;
		for (const term of terms) result.add(term);
	}
	result.delete(query);
	return result;
}

function toCandidate(
	view: ActiveWorkView,
	matchKind: AdvancedLinkMatchKind,
): AdvancedLinkCandidate {
	return {
		workId: view.work.id,
		displayName: view.displayName,
		shortId: view.work.id.slice(0, 8),
		updatedAt: view.work.updatedAt,
		unplaced: view.placements.length === 0,
		placements: view.placements,
		matchKind,
	};
}

export function previewDirection(
	source: string,
	type: LinkType,
	target: string,
	direction: RelationTypeDirection = "directed",
): string {
	switch (type) {
		case "FROM":
			return `「${source}」は「${target}」から派生します。`;
		case "SUPPORT":
			return `「${source}」は「${target}」を支持します。`;
		case "DEF":
			return `「${source}」は「${target}」を定義します。`;
		case "FIX":
			return `「${source}」は「${target}」を修正します。`;
		case "CITE":
			return `「${source}」は「${target}」を引用します。`;
		case "RELATED":
			return `「${source}」と「${target}」は関連します。`;
		case "LIKE":
			return `「${source}」と「${target}」は類似します。`;
		case "VS":
			return `「${source}」と「${target}」は対立します。`;
		default:
			return direction === "symmetric"
				? `「${source}」と「${target}」は ${type} 関係です。`
				: `「${source}」は「${target}」と ${type} 関係です。`;
	}
}
