import type { HistoricalTime } from "../domain/historical_time.ts";
import type {
	Bookmark,
	Branch,
	EmergenceAction,
	EmergenceSuggestion,
	LinkType,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	RelationTypeDefinition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import type { GraphStateSnapshot, MergeWorksInput, WorkBundle } from "./graph_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";

export abstract class SqliteMutationGraphStore extends MemoryGraphStore {
	protected abstract mutate<T>(operation: () => Promise<T>): Promise<T>;

	override restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		return this.mutate(() => this.restoreMemoryGraphState(state));
	}

	protected restoreMemoryGraphState(state: GraphStateSnapshot): Promise<void> {
		return super.restoreGraphState(state);
	}

	override mergeWorks(input: MergeWorksInput): Promise<void> {
		return this.mutate(() => super.mergeWorks(input));
	}

	override createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		return this.mutate(() => super.createWorkBundle(work, branch, workingCopy, occurrence));
	}

	override importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		return this.mutate(() => super.importWorkBundles(bundles));
	}

	override createUnplacedWork(work: Work, branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		return this.mutate(() => super.createUnplacedWork(work, branch, workingCopy));
	}

	override resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		return this.mutate(() => super.resolveWorkStub(workId, updatedAt));
	}

	override setWorkHistoricalTime(
		workId: string,
		value: HistoricalTime | null,
		updatedAt: string,
	): Promise<void> {
		return this.mutate(() => super.setWorkHistoricalTime(workId, value, updatedAt));
	}

	override createOccurrence(occurrence: Occurrence): Promise<void> {
		return this.mutate(() => super.createOccurrence(occurrence));
	}

	override createBookmark(bookmark: Bookmark): Promise<void> {
		return this.mutate(() => super.createBookmark(bookmark));
	}

	override deleteBookmark(id: string): Promise<void> {
		return this.mutate(() => super.deleteBookmark(id));
	}

	override createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		return this.mutate(() => super.createBranch(branch, workingCopy));
	}

	override updateBranch(branch: Branch): Promise<void> {
		return this.mutate(() => super.updateBranch(branch));
	}

	override createRevision(revision: Revision, branchId: string): Promise<void> {
		return this.mutate(() => super.createRevision(revision, branchId));
	}

	override createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		return this.mutate(() => super.createRecoverySnapshot(snapshot));
	}

	override restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		return this.mutate(() => super.restoreRecoverySnapshot(snapshotId, beforeRestore, updatedAt));
	}

	override promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		return this.mutate(() =>
			super.promoteRecoverySnapshot(snapshotId, revision, branchId, protectedAt)
		);
	}

	override deleteOccurrence(id: string): Promise<void> {
		return this.mutate(() => super.deleteOccurrence(id));
	}

	override trashWork(workId: string, deletedAt: string): Promise<void> {
		return this.mutate(() => super.trashWork(workId, deletedAt));
	}

	override restoreWork(workId: string): Promise<void> {
		return this.mutate(() => super.restoreWork(workId));
	}

	override purgeWork(workId: string): Promise<PurgeManifest> {
		return this.mutate(() => super.purgeWork(workId));
	}

	override createLink(link: OutlineLink): Promise<void> {
		return this.mutate(() => super.createLink(link));
	}

	override deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		return this.mutate(() => super.deleteLink(fromId, toId, type));
	}

	override upsertAlias(alias: SearchAlias): Promise<void> {
		return this.mutate(() => super.upsertAlias(alias));
	}

	override deleteAlias(id: string): Promise<void> {
		return this.mutate(() => super.deleteAlias(id));
	}

	override setEmergenceFeedback(
		id: string,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		return this.mutate(() => super.setEmergenceFeedback(id, action));
	}

	override upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		return this.mutate(() => super.upsertEmergenceSuggestion(suggestion));
	}

	override resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		return this.mutate(() => super.resolveEmergenceSuggestion(id, action, link, reason));
	}

	override upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		return this.mutate(() => super.upsertSavedRuleQuery(query));
	}

	override deleteSavedRuleQuery(id: string): Promise<void> {
		return this.mutate(() => super.deleteSavedRuleQuery(id));
	}

	override createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void> {
		return this.mutate(() => super.createRelationTypeDefinition(definition));
	}
}
