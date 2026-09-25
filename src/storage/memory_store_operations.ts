import type {
	Branch,
	LinkEndpoint,
	Occurrence,
	OutlineItem,
	OutlineLink,
	RelationTypeDefinition,
	Revision,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { BUILT_IN_RELATION_TYPES, isRelationTypeSymmetric } from "../domain/relation_type.ts";
import type { MergeWorksInput } from "./graph_store.ts";
import type { MemoryStateContainer } from "./memory_state_container.ts";

export type MutableMergeGraphState = Pick<
	MemoryStateContainer,
	| "works"
	| "branches"
	| "workingCopies"
	| "revisions"
	| "recoverySnapshots"
	| "bookmarks"
	| "resumePosition"
	| "occurrences"
	| "links"
	| "systemRelations"
	| "aliases"
	| "relationTypeDefinitions"
>;

export function applyMergeWorks(
	state: MutableMergeGraphState,
	input: MergeWorksInput,
): void {
	const source = state.works.find((work) => work.id === input.sourceWorkId);
	const survivor = state.works.find((work) => work.id === input.survivorWorkId);
	validateMergeInput(input, source, survivor, state.aliases);

	const next = structuredClone({
		works: state.works,
		branches: state.branches,
		workingCopies: state.workingCopies,
		revisions: state.revisions,
		recoverySnapshots: state.recoverySnapshots,
		bookmarks: state.bookmarks,
		resumePosition: state.resumePosition,
		occurrences: state.occurrences,
		links: state.links,
		systemRelations: state.systemRelations,
		aliases: state.aliases,
	});
	rewireMergedBranches(next.branches, input);
	rewireScopedEntities(next, input);
	rewireMergedLinks(next.links, input, state.relationTypeDefinitions);
	rewireSystemRelations(next.systemRelations, input);
	updateMergedWorks(next.works, input);
	if (input.alias) {
		next.aliases = [
			...next.aliases.filter((alias) => alias.id !== input.alias!.id),
			structuredClone(input.alias),
		];
	}

	Object.assign(state, next);
}

function rewireMergedBranches(branches: Branch[], input: MergeWorksInput): void {
	const takenNames = new Set(
		branches.filter((branch) => branch.workId === input.survivorWorkId).map((branch) =>
			branch.name
		),
	);
	for (const branch of branches.filter((entry) => entry.workId === input.sourceWorkId)) {
		branch.workId = input.survivorWorkId;
		branch.name = mergedBranchName(input.sourceWorkId, branch.name, takenNames);
		takenNames.add(branch.name);
	}
}

function reassignWorkId<T extends { workId: string }>(
	items: T[],
	fromWorkId: string,
	toWorkId: string,
): void {
	for (const item of items) {
		if (item.workId === fromWorkId) item.workId = toWorkId;
	}
}

function rewireScopedEntities(
	next: Pick<
		MutableMergeGraphState,
		| "workingCopies"
		| "revisions"
		| "recoverySnapshots"
		| "occurrences"
		| "bookmarks"
		| "resumePosition"
	>,
	input: MergeWorksInput,
): void {
	reassignWorkId(next.workingCopies, input.sourceWorkId, input.survivorWorkId);
	reassignWorkId(next.revisions, input.sourceWorkId, input.survivorWorkId);
	reassignWorkId(next.recoverySnapshots, input.sourceWorkId, input.survivorWorkId);
	reassignWorkId(next.occurrences, input.sourceWorkId, input.survivorWorkId);
	reassignWorkId(next.bookmarks, input.sourceWorkId, input.survivorWorkId);
	if (next.resumePosition?.workId === input.sourceWorkId) {
		next.resumePosition.workId = input.survivorWorkId;
	}
}

function rewireMergedLinks(
	links: OutlineLink[],
	input: MergeWorksInput,
	relationTypeDefinitions: readonly RelationTypeDefinition[],
): void {
	for (const link of links) {
		link.from = replaceEndpointWork(link.from, input);
		link.to = replaceEndpointWork(link.to, input);
		link.fromId = link.from.workId;
		link.toId = link.to.workId;
	}
	retractDuplicateActiveLinks(links, relationTypeDefinitions);
}

function rewireSystemRelations(relations: SystemRelation[], input: MergeWorksInput): void {
	for (const relation of relations) {
		if (relation.fromWorkId === input.sourceWorkId) relation.fromWorkId = input.survivorWorkId;
		if (relation.toWorkId === input.sourceWorkId) relation.toWorkId = input.survivorWorkId;
	}
}

function updateMergedWorks(works: Work[], input: MergeWorksInput): void {
	const sourceTombstone = works.find((work) => work.id === input.sourceWorkId);
	if (sourceTombstone) {
		sourceTombstone.mergedIntoWorkId = input.survivorWorkId;
		sourceTombstone.mergedAt = input.mergedAt;
	}
	const survivorNext = works.find((work) => work.id === input.survivorWorkId);
	if (survivorNext) {
		survivorNext.updatedAt = input.mergedAt;
	}
}

export function validateMergeInput(
	input: MergeWorksInput,
	source: Work | undefined,
	survivor: Work | undefined,
	aliases: readonly SearchAlias[],
): void {
	if (input.sourceWorkId === input.survivorWorkId) {
		throw new Error("Duplicate merge requires two different Works");
	}
	if (!source || source.deletedAt || source.mergedIntoWorkId) {
		throw new Error(`Active source Work not found: ${input.sourceWorkId}`);
	}
	if (!survivor || survivor.deletedAt || survivor.mergedIntoWorkId) {
		throw new Error(`Active survivor Work not found: ${input.survivorWorkId}`);
	}
	const parsed = Date.parse(input.mergedAt);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input.mergedAt) {
		throw new Error("Duplicate merge requires a valid ISO instant");
	}
	if (input.alias) {
		if (!input.alias.id || !input.alias.canonical.trim() || input.alias.variants.length === 0) {
			throw new Error("Duplicate merge alias requires a non-empty old name");
		}
		const collidingAlias = aliases.find((alias) =>
			alias.id === input.alias!.id && alias.canonical !== input.alias!.canonical
		);
		if (collidingAlias) throw new Error(`Search Alias ID collision: ${input.alias.id}`);
	}
}

export function mergedBranchName(
	sourceWorkId: string,
	original: string,
	taken: ReadonlySet<string>,
): string {
	const base = `merged/${sourceWorkId}/${original}`;
	let candidate = base;
	let suffix = 2;
	while (taken.has(candidate)) candidate = `${base}/${suffix++}`;
	return candidate;
}

export function replaceEndpointWork(
	endpoint: LinkEndpoint,
	input: MergeWorksInput,
): LinkEndpoint {
	if (endpoint.workId !== input.sourceWorkId) return endpoint;
	return {
		...endpoint,
		workId: input.survivorWorkId,
	};
}

export function endpointKey(endpoint: LinkEndpoint): string {
	return endpoint.scope === "revision"
		? `revision:${endpoint.workId}:${endpoint.revisionId}`
		: `work:${endpoint.workId}`;
}

export function retractDuplicateActiveLinks(
	links: OutlineLink[],
	relationTypeDefinitions: readonly RelationTypeDefinition[] = BUILT_IN_RELATION_TYPES,
): void {
	const seen = new Set<string>();
	for (const link of links) {
		if (link.status === "retracted") continue;
		const left = endpointKey(link.from);
		const right = endpointKey(link.to);
		const self = left === right;
		const isSymmetric = isRelationTypeSymmetric(link.type, relationTypeDefinitions);
		const endpoints = isSymmetric && left > right ? `${right}|${left}` : `${left}|${right}`;
		const key = `${link.type}|${endpoints}`;
		if (self || seen.has(key)) link.status = "retracted";
		else seen.add(key);
	}
}

export function projectOutlineItems(
	works: readonly Work[],
	workingCopies: readonly WorkingCopy[],
	revisions: readonly Revision[],
	occurrences: readonly Occurrence[],
	includeDeleted: boolean,
): OutlineItem[] {
	const workById = new Map(
		works.filter((work) => includeDeleted || !work.deletedAt).map((work) => [work.id, work]),
	);
	const copyByBranchId = new Map(workingCopies.map((copy) => [copy.branchId, copy]));
	const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
	return occurrences.flatMap((occurrence): OutlineItem[] => {
		const work = workById.get(occurrence.workId);
		if (!work) return [];
		const text = occurrence.revisionSelector.mode === "branch"
			? copyByBranchId.get(occurrence.revisionSelector.branchId)?.text ?? ""
			: revisionById.get(occurrence.revisionSelector.revisionId)?.text ?? "";
		return [{
			id: occurrence.id,
			workId: occurrence.workId,
			text,
			parentId: occurrence.parentOccurrenceId,
			orderKey: occurrence.orderKey,
			collapsed: occurrence.collapsed,
			revisionSelector: structuredClone(occurrence.revisionSelector),
			contextualHeading: occurrence.contextualHeading,
			createdAt: work.createdAt,
			...(work.historicalTime ? { historicalTime: structuredClone(work.historicalTime) } : {}),
			updatedAt: work.updatedAt,
		}];
	});
}
