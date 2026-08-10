import type {
	Branch,
	LinkEndpoint,
	Occurrence,
	OutlineLink,
	Revision,
	StubCreationKind,
	Work,
	WorkingCopy,
	WorkStub,
} from "../domain/models.ts";
import { LINK_TYPES } from "../domain/models.ts";
import type { GraphStateSnapshot, WorkBundle } from "./graph_store.ts";
import { isValidWorkStub } from "./graph_mutation_validation.ts";

export function validatedGraphStateSnapshot(value: unknown): GraphStateSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Backup data must be an object");
	}
	const source = value as Record<string, unknown>;
	for (
		const key of [
			"works",
			"branches",
			"workingCopies",
			"occurrences",
			"links",
			"systemRelations",
			"knots",
			"aliases",
			"emergenceSuggestions",
			"savedRuleQueries",
			"purgeManifests",
			"revisions",
			"recoverySnapshots",
			"bookmarks",
		]
	) {
		if (!Array.isArray(source[key])) throw new Error(`Backup data.${key} must be an array`);
	}
	if (
		!source.emergenceFeedback || typeof source.emergenceFeedback !== "object" ||
		Array.isArray(source.emergenceFeedback)
	) {
		throw new Error("Backup data.emergenceFeedback must be an object");
	}
	if (
		source.resumePosition !== null &&
		(!source.resumePosition || typeof source.resumePosition !== "object" ||
			Array.isArray(source.resumePosition))
	) {
		throw new Error("Backup data.resumePosition must be an object or null");
	}

	const state = structuredClone(value) as GraphStateSnapshot;
	const workById = uniqueById(state.works, "Work");
	const branchById = uniqueById(state.branches, "Branch");
	const occurrenceById = uniqueById(state.occurrences, "Occurrence");
	const revisionById = uniqueById(state.revisions, "Revision");
	uniqueById(state.recoverySnapshots, "Recovery Snapshot");
	uniqueById(state.links, "Link");
	uniqueById(state.systemRelations, "System Relation");
	uniqueById(state.knots, "Knot");
	uniqueById(state.aliases, "Search Alias");
	uniqueById(state.emergenceSuggestions, "Emergence Suggestion");
	uniqueById(state.savedRuleQueries, "Saved Rule Query");
	uniqueById(state.purgeManifests, "Purge Manifest");
	uniqueById(state.bookmarks, "Bookmark");
	const purgedWorkIds = new Set(state.purgeManifests.map((manifest) => manifest.workId));
	const purgedOccurrenceIds = new Set(
		state.purgeManifests.flatMap((manifest) => manifest.occurrenceIds),
	);

	for (const work of state.works) {
		if (
			!isIsoInstant(work.createdAt) || !isIsoInstant(work.updatedAt) ||
			(work.stub !== undefined && !isValidWorkStub(work.stub))
		) {
			throw new Error(`Invalid Work: ${work.id}`);
		}
		if (work.deletedAt && !isIsoInstant(work.deletedAt)) {
			throw new Error(`Invalid Work: ${work.id}`);
		}
		if (
			work.mergedIntoWorkId && !workById.has(work.mergedIntoWorkId) &&
			!purgedWorkIds.has(work.mergedIntoWorkId)
		) {
			throw new Error(`Merged Work target not found: ${work.mergedIntoWorkId}`);
		}
		if (
			work.mergedIntoWorkId === work.id ||
			(work.mergedIntoWorkId && !isIsoInstant(work.mergedAt))
		) {
			throw new Error(`Invalid Work merge provenance: ${work.id}`);
		}
	}
	for (const branch of state.branches) {
		if (
			!workById.has(branch.workId) || !branch.name || !isIsoInstant(branch.createdAt) ||
			(branch.promotedAt !== undefined && !isIsoInstant(branch.promotedAt)) ||
			(branch.archivedAt !== undefined && !isIsoInstant(branch.archivedAt))
		) {
			throw new Error(`Invalid Branch: ${branch.id}`);
		}
		if (branch.headRevisionId) {
			const head = revisionById.get(branch.headRevisionId);
			if (!head || head.workId !== branch.workId) {
				throw new Error(`Branch head Revision not found: ${branch.id}`);
			}
		}
	}
	const copyBranchIds = new Set<string>();
	for (const copy of state.workingCopies) {
		if (copyBranchIds.has(copy.branchId)) {
			throw new Error(`Working Copy ID collision: ${copy.branchId}`);
		}
		copyBranchIds.add(copy.branchId);
		const branch = branchById.get(copy.branchId);
		if (
			!branch || branch.workId !== copy.workId || !workById.has(copy.workId) ||
			typeof copy.text !== "string" || !isIsoInstant(copy.updatedAt)
		) {
			throw new Error(`Invalid Working Copy: ${copy.branchId}`);
		}
	}
	for (const revision of state.revisions) {
		if (
			!workById.has(revision.workId) || typeof revision.text !== "string" ||
			!Array.isArray(revision.parentRevisionIds) || !isIsoInstant(revision.createdAt) ||
			!["checkpoint", "edition", "merge"].includes(revision.kind)
		) {
			throw new Error(`Invalid Revision: ${revision.id}`);
		}
		const parents = new Set<string>();
		for (const parentId of revision.parentRevisionIds) {
			const parent = revisionById.get(parentId);
			if (
				!parent || parent.workId !== revision.workId || parentId === revision.id ||
				parents.has(parentId)
			) {
				throw new Error(`Invalid Revision parent: ${revision.id}`);
			}
			parents.add(parentId);
		}
	}
	assertRevisionDag(state.revisions);
	for (const snapshot of state.recoverySnapshots) {
		const branch = branchById.get(snapshot.branchId);
		const sourceRevision = snapshot.sourceRevisionId
			? revisionById.get(snapshot.sourceRevisionId)
			: undefined;
		if (
			!workById.has(snapshot.workId) || !branch || branch.workId !== snapshot.workId ||
			typeof snapshot.text !== "string" || !snapshot.contentHash ||
			!isIsoInstant(snapshot.createdAt) ||
			(snapshot.sourceRevisionId &&
				(!sourceRevision || sourceRevision.workId !== snapshot.workId))
		) {
			throw new Error(`Invalid Recovery Snapshot: ${snapshot.id}`);
		}
		if (
			snapshot.protection &&
			(!["user", "import", "schema-migration", "revision-source"].includes(
				snapshot.protection.reason,
			) ||
				!isIsoInstant(snapshot.protection.protectedAt) ||
				(snapshot.protection.expiresAt !== undefined &&
					!isIsoInstant(snapshot.protection.expiresAt)))
		) {
			throw new Error(`Invalid Recovery Snapshot protection: ${snapshot.id}`);
		}
	}
	for (const occurrence of state.occurrences) {
		if (
			!workById.has(occurrence.workId) || !Number.isFinite(occurrence.orderKey)
		) {
			throw new Error(`Invalid Occurrence: ${occurrence.id}`);
		}
		if (occurrence.revisionSelector.mode === "branch") {
			const branch = branchById.get(occurrence.revisionSelector.branchId);
			if (!branch || branch.workId !== occurrence.workId) {
				throw new Error(`Invalid Occurrence Branch: ${occurrence.id}`);
			}
		} else {
			const revision = revisionById.get(occurrence.revisionSelector.revisionId);

			if (!revision || revision.workId !== occurrence.workId) {
				throw new Error(`Invalid Occurrence Revision: ${occurrence.id}`);
			}
		}
	}
	for (const link of state.links) {
		validateLinkEndpoint(link.from, workById, revisionById, link.id);
		validateLinkEndpoint(link.to, workById, revisionById, link.id);
		if (link.fromId !== link.from.workId || link.toId !== link.to.workId) {
			throw new Error(`Invalid Link endpoint IDs: ${link.id}`);
		}
		if (
			!(LINK_TYPES as readonly string[]).includes(link.type) ||
			!["provisional", "asserted", "retracted"].includes(link.status) ||
			!["human", "suggestion", "import"].includes(link.origin) ||
			!isIsoInstant(link.createdAt)
		) {
			throw new Error(`Invalid Link: ${link.id}`);
		}
	}
	for (const relation of state.systemRelations) {
		if (
			!workById.has(relation.fromWorkId) || !workById.has(relation.toWorkId) ||
			relation.type !== "IN" || !isIsoInstant(relation.createdAt)
		) {
			throw new Error(`Invalid System Relation: ${relation.id}`);
		}
	}
	for (const knot of state.knots) {
		if (
			!Array.isArray(knot.cycleIds) ||
			knot.cycleIds.some((id) => !occurrenceById.has(id) && !purgedOccurrenceIds.has(id)) ||
			!isIsoInstant(knot.createdAt)
		) {
			throw new Error(`Invalid Knot: ${knot.id}`);
		}
	}
	for (const alias of state.aliases) {
		if (
			!alias.canonical || !Array.isArray(alias.variants) ||
			!isIsoInstant(alias.createdAt) || !isIsoInstant(alias.updatedAt)
		) {
			throw new Error(`Invalid Search Alias: ${alias.id}`);
		}
	}
	for (const suggestion of state.emergenceSuggestions) {
		if (
			(!workById.has(suggestion.contextWorkId) &&
				!purgedWorkIds.has(suggestion.contextWorkId)) ||
			(!workById.has(suggestion.targetWorkId) &&
				!purgedWorkIds.has(suggestion.targetWorkId)) ||
			(!purgedOccurrenceIds.has(suggestion.contextItemId) &&
				occurrenceById.get(suggestion.contextItemId)?.workId !== suggestion.contextWorkId) ||
			(!purgedOccurrenceIds.has(suggestion.targetItemId) &&
				occurrenceById.get(suggestion.targetItemId)?.workId !== suggestion.targetWorkId) ||
			!["pending", "accepted", "dismissed", "held"].includes(suggestion.persistenceStatus) ||
			!Number.isFinite(suggestion.score) || !Array.isArray(suggestion.evidence) ||
			!isIsoInstant(suggestion.createdAt) || !isIsoInstant(suggestion.updatedAt) ||
			(suggestion.resolvedAt !== undefined && !isIsoInstant(suggestion.resolvedAt))
		) {
			throw new Error(`Invalid Emergence Suggestion: ${suggestion.id}`);
		}
	}
	for (const query of state.savedRuleQueries) {
		if (
			!query.name || typeof query.source !== "string" ||
			!isIsoInstant(query.createdAt) || !isIsoInstant(query.updatedAt)
		) {
			throw new Error(`Invalid Saved Rule Query: ${query.id}`);
		}
	}
	for (const manifest of state.purgeManifests) {
		if (
			!manifest.workId || !Array.isArray(manifest.occurrenceIds) ||
			!Array.isArray(manifest.branchIds) || !Array.isArray(manifest.revisionIds) ||
			!Array.isArray(manifest.linkIds) || !isIsoInstant(manifest.purgedAt)
		) {
			throw new Error(`Invalid Purge Manifest: ${manifest.id}`);
		}
	}
	for (const bookmark of state.bookmarks) {
		const occurrence = occurrenceById.get(bookmark.occurrenceId);
		if (
			!workById.has(bookmark.workId) || occurrence?.workId !== bookmark.workId ||
			!isIsoInstant(bookmark.createdAt)
		) {
			throw new Error(`Invalid Bookmark: ${bookmark.id}`);
		}
	}
	if (state.resumePosition) {
		const occurrence = occurrenceById.get(state.resumePosition.occurrenceId);
		if (
			!workById.has(state.resumePosition.workId) ||
			occurrence?.workId !== state.resumePosition.workId ||
			!Number.isInteger(state.resumePosition.caretOffset) ||
			state.resumePosition.caretOffset < 0 || !isIsoInstant(state.resumePosition.updatedAt)
		) {
			throw new Error("Invalid Resume Position");
		}
	}
	for (const action of Object.values(state.emergenceFeedback)) {
		if (action !== "accept" && action !== "dismiss" && action !== "pin") {
			throw new Error("Invalid emergence feedback");
		}
	}
	return state;
}

function uniqueById<T extends { id: string }>(
	entries: readonly T[],
	label: string,
): Map<string, T> {
	const result = new Map<string, T>();
	for (const entry of entries) {
		if (!entry?.id || result.has(entry.id)) throw new Error(`${label} ID collision: ${entry?.id}`);
		result.set(entry.id, entry);
	}
	return result;
}

function isIsoInstant(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function assertRevisionDag(revisions: readonly Revision[]): void {
	const parents = new Map(revisions.map((revision) => [revision.id, revision.parentRevisionIds]));
	const complete = new Set<string>();
	const visit = (id: string, path: Set<string>): void => {
		if (complete.has(id)) return;
		if (path.has(id)) throw new Error(`Revision cycle: ${id}`);
		const nextPath = new Set(path).add(id);
		for (const parent of parents.get(id) ?? []) visit(parent, nextPath);
		complete.add(id);
	};
	for (const id of parents.keys()) visit(id, new Set());
}

function validateLinkEndpoint(
	endpoint: OutlineLink["from"],
	works: ReadonlyMap<string, Work>,
	revisions: ReadonlyMap<string, Revision>,
	linkId: string,
): void {
	if (!works.has(endpoint.workId)) throw new Error(`Invalid Link Work endpoint: ${linkId}`);
	if (endpoint.scope === "revision") {
		const revision = revisions.get(endpoint.revisionId);
		if (!revision || revision.workId !== endpoint.workId) {
			throw new Error(`Invalid Link Revision endpoint: ${linkId}`);
		}
	}
}
