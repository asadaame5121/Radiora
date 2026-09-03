import type {
	LinkEndpoint,
	Occurrence,
	OutlineItem,
	OutlineLink,
	RecoverySnapshot,
	RelationTypeDefinition,
	Revision,
	SearchAlias,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { BUILT_IN_RELATION_TYPES, isRelationTypeSymmetric } from "../domain/relation_type.ts";
import type { MergeWorksInput } from "./graph_store.ts";

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
			updatedAt: work.updatedAt,
		}];
	});
}
