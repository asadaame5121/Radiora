import * as v from "valibot";
import type {
	Bookmark,
	Branch,
	EmergenceSuggestion,
	Knot,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import {
	BUILT_IN_RELATION_TYPES,
	validateRelationTypeDefinitions,
} from "../domain/relation_type.ts";
import {
	BookmarkSchema,
	BranchSchema,
	EmergenceActionSchema,
	EmergenceSuggestionSchema,
	KnotSchema,
	OccurrenceSchema,
	OutlineLinkSchema,
	PurgeManifestSchema,
	RecoverySnapshotSchema,
	ResumePositionSchema,
	RevisionSchema,
	SavedRuleQuerySchema,
	SearchAliasSchema,
	SystemRelationSchema,
	WorkingCopySchema,
	WorkSchema,
} from "../domain/schemas.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";
import { assertRevisionDag } from "./revision_dag_validation.ts";

export function validatedGraphStateSnapshot(value: unknown): GraphStateSnapshot {
	assertSnapshotContainer(value);
	const source = value as Record<string, unknown>;
	const state = structuredClone(value) as GraphStateSnapshot;
	if (!("relationTypeDefinitions" in source)) {
		state.relationTypeDefinitions = BUILT_IN_RELATION_TYPES.map((def) => ({ ...def }));
	} else {
		state.relationTypeDefinitions = validateRelationTypeDefinitions(source.relationTypeDefinitions);
	}
	const relationTypeNames = new Set(state.relationTypeDefinitions.map((def) => def.name));
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

	validateWorks(state.works, workById, purgedWorkIds);
	validateBranches(state.branches, workById, revisionById);
	validateWorkingCopies(state.workingCopies, branchById, workById);
	validateRevisions(state.revisions, workById, revisionById);
	validateRecoverySnapshots(state.recoverySnapshots, workById, branchById, revisionById);
	validateOccurrences(state.occurrences, workById, branchById, revisionById);
	validateLinks(state.links, relationTypeNames, workById, revisionById);
	validateSystemRelations(state.systemRelations, workById);
	validateKnots(state.knots, occurrenceById, purgedOccurrenceIds);
	validateAliases(state.aliases);
	validateEmergenceSuggestions(
		state.emergenceSuggestions,
		workById,
		occurrenceById,
		purgedWorkIds,
		purgedOccurrenceIds,
	);
	validateSavedRuleQueries(state.savedRuleQueries);
	validatePurgeManifests(state.purgeManifests);
	validateBookmarks(state.bookmarks, workById, occurrenceById);
	validateResumePosition(state.resumePosition, workById, occurrenceById);
	validateEmergenceFeedback(state.emergenceFeedback);

	return state;
}

function assertSnapshotContainer(value: unknown): void {
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
}

function validateWorks(
	works: readonly Work[],
	workById: ReadonlyMap<string, Work>,
	purgedWorkIds: ReadonlySet<string>,
): void {
	for (const work of works) {
		const parsed = v.safeParse(WorkSchema, work);
		if (!parsed.success) {
			throw new Error(`Invalid Work: ${work?.id}`);
		}
		if (
			work.mergedIntoWorkId && !workById.has(work.mergedIntoWorkId) &&
			!purgedWorkIds.has(work.mergedIntoWorkId)
		) {
			throw new Error(`Merged Work target not found: ${work.mergedIntoWorkId}`);
		}
		if (
			work.mergedIntoWorkId === work.id ||
			(work.mergedIntoWorkId && !work.mergedAt)
		) {
			throw new Error(`Invalid Work merge provenance: ${work.id}`);
		}
	}
}

function validateBranches(
	branches: readonly Branch[],
	workById: ReadonlyMap<string, Work>,
	revisionById: ReadonlyMap<string, Revision>,
): void {
	for (const branch of branches) {
		const parsed = v.safeParse(BranchSchema, branch);
		if (!parsed.success || !workById.has(branch.workId)) {
			throw new Error(`Invalid Branch: ${branch?.id}`);
		}
		if (branch.headRevisionId) {
			const head = revisionById.get(branch.headRevisionId);
			if (!head || head.workId !== branch.workId) {
				throw new Error(`Branch head Revision not found: ${branch.id}`);
			}
		}
	}
}

function validateWorkingCopies(
	workingCopies: readonly WorkingCopy[],
	branchById: ReadonlyMap<string, Branch>,
	workById: ReadonlyMap<string, Work>,
): void {
	const copyBranchIds = new Set<string>();
	for (const copy of workingCopies) {
		if (copyBranchIds.has(copy.branchId)) {
			throw new Error(`Working Copy ID collision: ${copy.branchId}`);
		}
		copyBranchIds.add(copy.branchId);
		const branch = branchById.get(copy.branchId);
		const parsed = v.safeParse(WorkingCopySchema, copy);
		if (
			!parsed.success || !branch || branch.workId !== copy.workId || !workById.has(copy.workId)
		) {
			throw new Error(`Invalid Working Copy: ${copy.branchId}`);
		}
	}
}

function validateRevisions(
	revisions: readonly Revision[],
	workById: ReadonlyMap<string, Work>,
	revisionById: ReadonlyMap<string, Revision>,
): void {
	for (const revision of revisions) {
		const parsed = v.safeParse(RevisionSchema, revision);
		if (!parsed.success || !workById.has(revision.workId)) {
			throw new Error(`Invalid Revision: ${revision?.id}`);
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
	assertRevisionDag(revisions);
}

function validateRecoverySnapshots(
	recoverySnapshots: readonly RecoverySnapshot[],
	workById: ReadonlyMap<string, Work>,
	branchById: ReadonlyMap<string, Branch>,
	revisionById: ReadonlyMap<string, Revision>,
): void {
	for (const snapshot of recoverySnapshots) {
		const branch = branchById.get(snapshot.branchId);
		const sourceRevision = snapshot.sourceRevisionId
			? revisionById.get(snapshot.sourceRevisionId)
			: undefined;
		const parsed = v.safeParse(RecoverySnapshotSchema, snapshot);
		if (
			!parsed.success || !workById.has(snapshot.workId) || !branch ||
			branch.workId !== snapshot.workId ||
			(snapshot.sourceRevisionId &&
				(!sourceRevision || sourceRevision.workId !== snapshot.workId))
		) {
			throw new Error(`Invalid Recovery Snapshot: ${snapshot.id}`);
		}
	}
}

function validateOccurrences(
	occurrences: readonly Occurrence[],
	workById: ReadonlyMap<string, Work>,
	branchById: ReadonlyMap<string, Branch>,
	revisionById: ReadonlyMap<string, Revision>,
): void {
	for (const occurrence of occurrences) {
		const parsed = v.safeParse(OccurrenceSchema, occurrence);
		if (!parsed.success || !workById.has(occurrence.workId)) {
			throw new Error(`Invalid Occurrence: ${occurrence?.id}`);
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
}

function validateLinks(
	links: readonly OutlineLink[],
	relationTypeNames: ReadonlySet<string>,
	workById: ReadonlyMap<string, Work>,
	revisionById: ReadonlyMap<string, Revision>,
): void {
	for (const link of links) {
		const parsed = v.safeParse(OutlineLinkSchema, link);
		if (!parsed.success || !relationTypeNames.has(link.type)) {
			throw new Error(`Invalid Link: ${link?.id}`);
		}
		validateLinkEndpoint(link.from, workById, revisionById, link.id);
		validateLinkEndpoint(link.to, workById, revisionById, link.id);
		if (link.fromId !== link.from.workId || link.toId !== link.to.workId) {
			throw new Error(`Invalid Link endpoint IDs: ${link.id}`);
		}
	}
}

function validateSystemRelations(
	systemRelations: readonly SystemRelation[],
	workById: ReadonlyMap<string, Work>,
): void {
	for (const relation of systemRelations) {
		const parsed = v.safeParse(SystemRelationSchema, relation);
		if (
			!parsed.success || !workById.has(relation.fromWorkId) || !workById.has(relation.toWorkId)
		) {
			throw new Error(`Invalid System Relation: ${relation?.id}`);
		}
	}
}

function validateKnots(
	knots: readonly Knot[],
	occurrenceById: ReadonlyMap<string, Occurrence>,
	purgedOccurrenceIds: ReadonlySet<string>,
): void {
	for (const k of knots) {
		if (
			!v.safeParse(KnotSchema, k).success ||
			k.cycleIds.some((id) => !occurrenceById.has(id) && !purgedOccurrenceIds.has(id))
		) {
			throw new Error(`Invalid Knot: ${k?.id}`);
		}
	}
}

function validateAliases(aliases: readonly SearchAlias[]): void {
	for (const a of aliases) {
		if (!v.safeParse(SearchAliasSchema, a).success) {
			throw new Error(`Invalid Search Alias: ${a?.id}`);
		}
	}
}

function validateEmergenceSuggestions(
	suggestions: readonly EmergenceSuggestion[],
	workById: ReadonlyMap<string, Work>,
	occurrenceById: ReadonlyMap<string, Occurrence>,
	purgedWorkIds: ReadonlySet<string>,
	purgedOccurrenceIds: ReadonlySet<string>,
): void {
	for (const s of suggestions) {
		if (
			!v.safeParse(EmergenceSuggestionSchema, s).success ||
			(!workById.has(s.contextWorkId) && !purgedWorkIds.has(s.contextWorkId)) ||
			(!workById.has(s.targetWorkId) && !purgedWorkIds.has(s.targetWorkId)) ||
			(!purgedOccurrenceIds.has(s.contextItemId) &&
				occurrenceById.get(s.contextItemId)?.workId !== s.contextWorkId) ||
			(!purgedOccurrenceIds.has(s.targetItemId) &&
				occurrenceById.get(s.targetItemId)?.workId !== s.targetWorkId)
		) {
			throw new Error(`Invalid Emergence Suggestion: ${s?.id}`);
		}
	}
}

function validateSavedRuleQueries(savedRuleQueries: readonly SavedRuleQuery[]): void {
	for (const q of savedRuleQueries) {
		if (!v.safeParse(SavedRuleQuerySchema, q).success) {
			throw new Error(`Invalid Saved Rule Query: ${q?.id}`);
		}
	}
}

function validatePurgeManifests(purgeManifests: readonly PurgeManifest[]): void {
	for (const m of purgeManifests) {
		if (!v.safeParse(PurgeManifestSchema, m).success) {
			throw new Error(`Invalid Purge Manifest: ${m?.id}`);
		}
	}
}

function validateBookmarks(
	bookmarks: readonly Bookmark[],
	workById: ReadonlyMap<string, Work>,
	occurrenceById: ReadonlyMap<string, Occurrence>,
): void {
	for (const b of bookmarks) {
		const occ = occurrenceById.get(b.occurrenceId);
		if (
			!v.safeParse(BookmarkSchema, b).success || !workById.has(b.workId) || occ?.workId !== b.workId
		) {
			throw new Error(`Invalid Bookmark: ${b?.id}`);
		}
	}
}

function validateResumePosition(
	resumePosition: ResumePosition | null,
	workById: ReadonlyMap<string, Work>,
	occurrenceById: ReadonlyMap<string, Occurrence>,
): void {
	if (!resumePosition) return;
	const occ = occurrenceById.get(resumePosition.occurrenceId);
	if (
		!v.safeParse(ResumePositionSchema, resumePosition).success ||
		!workById.has(resumePosition.workId) || occ?.workId !== resumePosition.workId ||
		resumePosition.caretOffset < 0
	) {
		throw new Error("Invalid Resume Position");
	}
}

function validateEmergenceFeedback(emergenceFeedback: Record<string, unknown>): void {
	for (const action of Object.values(emergenceFeedback)) {
		if (!v.safeParse(EmergenceActionSchema, action).success) {
			throw new Error("Invalid emergence feedback");
		}
	}
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

function validateLinkEndpoint(
	endpoint: OutlineLink["from"],
	works: ReadonlyMap<string, Work>,
	revisions: ReadonlyMap<string, Revision>,
	linkId: string,
): void {
	if (!works.has(endpoint.workId)) throw new Error(`Invalid Link Work endpoint: ${linkId}`);
	if (
		endpoint.scope === "revision" && revisions.get(endpoint.revisionId)?.workId !== endpoint.workId
	) {
		throw new Error(`Invalid Link Revision endpoint: ${linkId}`);
	}
}
