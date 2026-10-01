import type { HistoricalTime } from "../domain/historical_time.ts";
import type {
	Bookmark,
	Branch,
	EmergenceAction,
	EmergenceSuggestion,
	Knot,
	LinkType,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	RelationTypeDefinition,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { MemoryGraphStore } from "./memory_store.ts";
import { type GraphStateSnapshot, type MergeWorksInput, type WorkBundle } from "./graph_store.ts";
import { decodeJsonGraph } from "./json_graph_codec.ts";

import { JsonPersistence, type JsonRestoreFileOperations } from "./json_persistence.ts";

export { migrateBackupV0 } from "./backup_migrations.ts";

export type { JsonRestoreFileOperations } from "./json_persistence.ts";

export class JsonGraphStore extends MemoryGraphStore {
	private readonly persistence: JsonPersistence;
	constructor(
		private readonly path: string | URL,
		restoreFileOperations?: JsonRestoreFileOperations,
	) {
		super();
		this.persistence = new JsonPersistence(path, {
			capture: () => this.state.capture(),
			rollback: (state) => this.state.rollback(state),
			exportGraphState: () => this.exportGraphState(),
			restoreGraphState: (state) => super.restoreGraphState(state),
		}, restoreFileOperations);
	}

	override async initialize(): Promise<void> {
		try {
			const parsed: unknown = JSON.parse(await Deno.readTextFile(this.path));
			const decoded = decodeJsonGraph(parsed);
			this.state.restoreGraphState(decoded.data);
			if (decoded.protectionVersion !== null) {
				await this.protectVersionInput(decoded.protectionVersion);
				await this.persistence.persist();
			}
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) throw cause;
		}
	}

	override async createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		await this.persistence.mutate(() =>
			super.createWorkBundle(work, branch, workingCopy, occurrence)
		);
	}

	override async importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		await this.persistence.mutateWithRollback(() => super.importWorkBundles(bundles));
	}

	override async restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		await this.persistence.restoreGraphState(state);
	}

	override async createUnplacedWork(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
	): Promise<void> {
		await this.persistence.mutateWithRollback(() =>
			super.createUnplacedWork(work, branch, workingCopy)
		);
	}

	override async resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		await this.persistence.mutate(() => super.resolveWorkStub(workId, updatedAt));
	}

	override async setWorkHistoricalTime(
		workId: string,
		value: HistoricalTime | null,
		updatedAt: string,
	): Promise<void> {
		await this.persistence.mutateWithRollback(() =>
			super.setWorkHistoricalTime(workId, value, updatedAt)
		);
	}

	override async mergeWorks(input: MergeWorksInput): Promise<void> {
		await this.persistence.mutateWithRollback(() => super.mergeWorks(input));
	}

	override async createOccurrence(occurrence: Occurrence): Promise<void> {
		await this.persistence.mutate(() => super.createOccurrence(occurrence));
	}

	override async createBookmark(bookmark: Bookmark): Promise<void> {
		await this.persistence.mutate(() => super.createBookmark(bookmark));
	}

	override async deleteBookmark(id: string): Promise<void> {
		await this.persistence.mutate(() => super.deleteBookmark(id));
	}

	override async setResumePosition(position: ResumePosition): Promise<void> {
		await this.persistence.mutate(() => super.setResumePosition(position));
	}

	override async clearResumePosition(): Promise<void> {
		await this.persistence.mutate(() => super.clearResumePosition());
	}

	override async createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		await this.persistence.mutate(() => super.createBranch(branch, workingCopy));
	}

	override async updateBranch(branch: Branch): Promise<void> {
		await this.persistence.mutate(() => super.updateBranch(branch));
	}

	override async updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		await this.persistence.mutate(() => super.updateBranchWorkingCopy(branchId, text, updatedAt));
	}

	override async updateWorkingCopy(
		workId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		await this.persistence.mutate(() => super.updateWorkingCopy(workId, text, updatedAt));
	}

	override async createRevision(revision: Revision, branchId: string): Promise<void> {
		await this.persistence.mutate(() => super.createRevision(revision, branchId));
	}

	override async createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		await this.persistence.mutate(() => super.createRecoverySnapshot(snapshot));
	}

	override async applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		await this.persistence.mutate(() => super.applyRecoverySnapshot(snapshotId, updatedAt));
	}

	override async restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		await this.persistence.mutateWithRollback(() =>
			super.restoreRecoverySnapshot(snapshotId, beforeRestore, updatedAt)
		);
	}

	override async promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		await this.persistence.mutateWithRollback(() =>
			super.promoteRecoverySnapshot(snapshotId, revision, branchId, protectedAt)
		);
	}

	override async updateOccurrence(occurrence: Occurrence): Promise<void> {
		await this.persistence.mutate(() => super.updateOccurrence(occurrence));
	}

	override async deleteOccurrence(id: string): Promise<void> {
		await this.persistence.mutate(() => super.deleteOccurrence(id));
	}

	override async trashWork(workId: string, deletedAt: string): Promise<void> {
		await this.persistence.mutate(() => super.trashWork(workId, deletedAt));
	}

	override async restoreWork(workId: string): Promise<void> {
		await this.persistence.mutate(() => super.restoreWork(workId));
	}

	override async purgeWork(workId: string): Promise<PurgeManifest> {
		return await this.persistence.mutate(() => super.purgeWork(workId));
	}

	override async createLink(link: OutlineLink): Promise<void> {
		await this.persistence.mutate(() => super.createLink(link));
	}

	override async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		await this.persistence.mutate(() => super.deleteLink(fromId, toId, type));
	}

	override async replaceKnots(knots: Knot[]): Promise<void> {
		await this.persistence.mutate(() => super.replaceKnots(knots));
	}

	override async upsertAlias(alias: SearchAlias): Promise<void> {
		await this.persistence.mutate(() => super.upsertAlias(alias));
	}

	override async deleteAlias(id: string): Promise<void> {
		await this.persistence.mutate(() => super.deleteAlias(id));
	}

	override async setEmergenceFeedback(
		id: string,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		await this.persistence.mutate(() => super.setEmergenceFeedback(id, action));
	}

	override async upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		await this.persistence.mutate(() => super.upsertEmergenceSuggestion(suggestion));
	}

	override async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		await this.persistence.mutateWithRollback(() =>
			super.resolveEmergenceSuggestion(id, action, link, reason)
		);
	}

	override async upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		await this.persistence.mutate(() => super.upsertSavedRuleQuery(query));
	}

	override async deleteSavedRuleQuery(id: string): Promise<void> {
		await this.persistence.mutate(() => super.deleteSavedRuleQuery(id));
	}

	override async createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void> {
		await this.persistence.mutateWithRollback(() => super.createRelationTypeDefinition(definition));
	}

	private async protectVersionInput(version: number): Promise<void> {
		const backup = typeof this.path === "string"
			? `${this.path}.v${version}.bak`
			: new URL(`${this.path.href}.v${version}.bak`);
		try {
			await Deno.stat(backup);
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) throw cause;
			await Deno.copyFile(this.path, backup);
		}
	}
}
