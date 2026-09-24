import type {
	Bookmark,
	Branch,
	EmergenceSuggestion,
	Knot,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	RelationTypeDefinition,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";
import { type GraphStateSnapshot, validatedGraphStateSnapshot } from "./graph_store.ts";

/**
 * Encapsulates the in-memory graph state container, providing single ownership
 * for all domain state arrays/records and transactional snapshot/rollback capabilities.
 */
export class MemoryStateContainer {
	works: Work[] = [];
	branches: Branch[] = [];
	workingCopies: WorkingCopy[] = [];
	revisions: Revision[] = [];
	recoverySnapshots: RecoverySnapshot[] = [];
	bookmarks: Bookmark[] = [];
	resumePosition: ResumePosition | null = null;
	occurrences: Occurrence[] = [];
	links: OutlineLink[] = [];
	systemRelations: SystemRelation[] = [];
	knots: Knot[] = [];
	aliases: SearchAlias[] = [];
	emergenceFeedback: Record<string, "accept" | "dismiss" | "pin"> = {};
	emergenceSuggestions: EmergenceSuggestion[] = [];
	savedRuleQueries: SavedRuleQuery[] = [];
	purgeManifests: PurgeManifest[] = [];
	relationTypeDefinitions: RelationTypeDefinition[] = BUILT_IN_RELATION_TYPES.map((def) => ({
		...def,
	}));

	exportGraphState(): GraphStateSnapshot {
		return structuredClone({
			works: this.works,
			branches: this.branches,
			workingCopies: this.workingCopies,
			occurrences: this.occurrences,
			links: this.links,
			systemRelations: this.systemRelations,
			knots: this.knots,
			aliases: this.aliases,
			emergenceFeedback: this.emergenceFeedback,
			emergenceSuggestions: this.emergenceSuggestions,
			savedRuleQueries: this.savedRuleQueries,
			purgeManifests: this.purgeManifests,
			revisions: this.revisions,
			recoverySnapshots: this.recoverySnapshots,
			bookmarks: this.bookmarks,
			resumePosition: this.resumePosition,
			relationTypeDefinitions: this.relationTypeDefinitions,
		});
	}

	restoreGraphState(state: GraphStateSnapshot): void {
		const validated = validatedGraphStateSnapshot(state);
		this.works = validated.works;
		this.branches = validated.branches;
		this.workingCopies = validated.workingCopies;
		this.occurrences = validated.occurrences;
		this.links = validated.links;
		this.systemRelations = validated.systemRelations;
		this.knots = validated.knots;
		this.aliases = validated.aliases;
		this.emergenceFeedback = validated.emergenceFeedback;
		this.emergenceSuggestions = validated.emergenceSuggestions;
		this.savedRuleQueries = validated.savedRuleQueries;
		this.purgeManifests = validated.purgeManifests;
		this.revisions = validated.revisions;
		this.recoverySnapshots = validated.recoverySnapshots;
		this.bookmarks = validated.bookmarks;
		this.resumePosition = validated.resumePosition;
		this.relationTypeDefinitions = validated.relationTypeDefinitions
			? structuredClone(validated.relationTypeDefinitions)
			: BUILT_IN_RELATION_TYPES.map((def) => ({ ...def }));
	}

	capture(): GraphStateSnapshot {
		return this.exportGraphState();
	}

	rollback(state: GraphStateSnapshot): void {
		const cloned = structuredClone(state);
		this.works = cloned.works;
		this.branches = cloned.branches;
		this.workingCopies = cloned.workingCopies;
		this.occurrences = cloned.occurrences;
		this.links = cloned.links;
		this.systemRelations = cloned.systemRelations;
		this.knots = cloned.knots;
		this.aliases = cloned.aliases;
		this.emergenceFeedback = cloned.emergenceFeedback;
		this.emergenceSuggestions = cloned.emergenceSuggestions;
		this.savedRuleQueries = cloned.savedRuleQueries;
		this.purgeManifests = cloned.purgeManifests;
		this.revisions = cloned.revisions;
		this.recoverySnapshots = cloned.recoverySnapshots;
		this.bookmarks = cloned.bookmarks;
		this.resumePosition = cloned.resumePosition;
		this.relationTypeDefinitions = cloned.relationTypeDefinitions
			? structuredClone(cloned.relationTypeDefinitions)
			: BUILT_IN_RELATION_TYPES.map((def) => ({ ...def }));
	}

	reset(): void {
		this.works = [];
		this.branches = [];
		this.workingCopies = [];
		this.revisions = [];
		this.recoverySnapshots = [];
		this.bookmarks = [];
		this.resumePosition = null;
		this.occurrences = [];
		this.links = [];
		this.systemRelations = [];
		this.knots = [];
		this.aliases = [];
		this.emergenceFeedback = {};
		this.emergenceSuggestions = [];
		this.savedRuleQueries = [];
		this.purgeManifests = [];
		this.relationTypeDefinitions = BUILT_IN_RELATION_TYPES.map((def) => ({ ...def }));
	}
}
