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
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { MemoryGraphStore } from "./memory_store.ts";
import type { GraphStateSnapshot, MergeWorksInput, WorkBundle } from "./graph_store.ts";
import {
	type BackupV0,
	type BackupV1,
	type BackupV2,
	type BackupV3,
	type BackupV4,
	type BackupV5,
	type BackupV6,
	migrateBackupV0,
	migrateBackupV1,
	migrateBackupV2,
	migrateBackupV3,
	migrateBackupV4,
	migrateBackupV5,
	type StoredGraphV6,
} from "./backup_migrations.ts";

export { migrateBackupV0 } from "./backup_migrations.ts";

export interface JsonRestoreFileOperations {
	writeTextFile(path: string | URL, data: string): Promise<void>;
	rename(oldPath: string | URL, newPath: string | URL): Promise<void>;
	remove(path: string | URL): Promise<void>;
}

const denoRestoreFileOperations: JsonRestoreFileOperations = {
	writeTextFile: (path, data) => Deno.writeTextFile(path, data),
	rename: (oldPath, newPath) => Deno.rename(oldPath, newPath),
	remove: (path) => Deno.remove(path),
};

export class JsonGraphStore extends MemoryGraphStore {
	constructor(
		private readonly path: string | URL,
		private readonly restoreFileOperations = denoRestoreFileOperations,
	) {
		super();
	}

	override async initialize(): Promise<void> {
		try {
			const parsed = JSON.parse(await Deno.readTextFile(this.path)) as
				| BackupV0
				| BackupV1
				| BackupV2
				| BackupV3
				| BackupV4
				| BackupV5
				| BackupV6;
			const data = "schemaVersion" in parsed ? this.readVersioned(parsed) : migrateBackupV5(
				migrateBackupV4(
					migrateBackupV3(migrateBackupV2(migrateBackupV1(migrateBackupV0(parsed)))),
				),
			);
			this.load(data);
			if (!("schemaVersion" in parsed)) {
				await this.protectVersionInput(0);
				await this.persist();
			} else if (parsed.schemaVersion === 1) {
				await this.protectVersionInput(parsed.schemaVersion);
				await this.persist();
			} else if (parsed.schemaVersion === 2) {
				await this.protectVersionInput(parsed.schemaVersion);
				await this.persist();
			} else if (parsed.schemaVersion === 3) {
				await this.protectVersionInput(parsed.schemaVersion);
				await this.persist();
			} else if (parsed.schemaVersion === 4) {
				await this.protectVersionInput(parsed.schemaVersion);
				await this.persist();
			} else if (parsed.schemaVersion === 5) {
				await this.protectVersionInput(parsed.schemaVersion);
				await this.persist();
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
		await super.createWorkBundle(work, branch, workingCopy, occurrence);
		await this.persist();
	}

	override async importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		const before = this.captureAllState();
		try {
			await super.importWorkBundles(bundles);
			await this.persist();
		} catch (cause) {
			this.restoreAllState(before);
			throw cause;
		}
	}

	override async restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		const before = await this.exportGraphState();
		const temporaryPath = typeof this.path === "string"
			? `${this.path}.restore-${crypto.randomUUID()}.tmp`
			: new URL(`${this.path.href}.restore-${crypto.randomUUID()}.tmp`);
		try {
			await super.restoreGraphState(state);
			const backup = this.currentBackup(await this.exportGraphState());
			await this.restoreFileOperations.writeTextFile(
				temporaryPath,
				JSON.stringify(backup, null, 2),
			);
			await this.restoreFileOperations.rename(temporaryPath, this.path);
		} catch (cause) {
			await super.restoreGraphState(before);
			try {
				await this.restoreFileOperations.remove(temporaryPath);
			} catch (cleanupCause) {
				if (!(cleanupCause instanceof Deno.errors.NotFound)) {
					// Preserve the original restore error; a stale temp file is safe to ignore.
				}
			}
			throw cause;
		}
	}

	override async createUnplacedWork(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
	): Promise<void> {
		const before = {
			works: structuredClone(this.works),
			branches: structuredClone(this.branches),
			workingCopies: structuredClone(this.workingCopies),
		};
		try {
			await super.createUnplacedWork(work, branch, workingCopy);
			await this.persist();
		} catch (cause) {
			this.works = before.works;
			this.branches = before.branches;
			this.workingCopies = before.workingCopies;
			throw cause;
		}
	}

	override async resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		await super.resolveWorkStub(workId, updatedAt);
		await this.persist();
	}

	override async mergeWorks(input: MergeWorksInput): Promise<void> {
		const before = this.captureAllState();
		try {
			await super.mergeWorks(input);
			await this.persist();
		} catch (cause) {
			this.restoreAllState(before);
			throw cause;
		}
	}

	override async createOccurrence(occurrence: Occurrence): Promise<void> {
		await super.createOccurrence(occurrence);
		await this.persist();
	}

	override async createBookmark(bookmark: Bookmark): Promise<void> {
		await super.createBookmark(bookmark);
		await this.persist();
	}

	override async deleteBookmark(id: string): Promise<void> {
		await super.deleteBookmark(id);
		await this.persist();
	}

	override async setResumePosition(position: ResumePosition): Promise<void> {
		await super.setResumePosition(position);
		await this.persist();
	}

	override async clearResumePosition(): Promise<void> {
		await super.clearResumePosition();
		await this.persist();
	}

	override async createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		await super.createBranch(branch, workingCopy);
		await this.persist();
	}

	override async updateBranch(branch: Branch): Promise<void> {
		await super.updateBranch(branch);
		await this.persist();
	}

	override async updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		await super.updateBranchWorkingCopy(branchId, text, updatedAt);
		await this.persist();
	}

	override async updateWorkingCopy(
		workId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		await super.updateWorkingCopy(workId, text, updatedAt);
		await this.persist();
	}

	override async createRevision(revision: Revision, branchId: string): Promise<void> {
		await super.createRevision(revision, branchId);
		await this.persist();
	}

	override async createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		await super.createRecoverySnapshot(snapshot);
		await this.persist();
	}

	override async applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		await super.applyRecoverySnapshot(snapshotId, updatedAt);
		await this.persist();
	}

	override async restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		const before = this.captureRecoveryMutationState();
		try {
			await super.restoreRecoverySnapshot(snapshotId, beforeRestore, updatedAt);
			await this.persist();
		} catch (cause) {
			this.restoreRecoveryMutationState(before);
			throw cause;
		}
	}

	override async promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		const before = this.captureRecoveryMutationState();
		try {
			await super.promoteRecoverySnapshot(snapshotId, revision, branchId, protectedAt);
			await this.persist();
		} catch (cause) {
			this.restoreRecoveryMutationState(before);
			throw cause;
		}
	}

	override async updateOccurrence(occurrence: Occurrence): Promise<void> {
		await super.updateOccurrence(occurrence);
		await this.persist();
	}

	override async deleteOccurrence(id: string): Promise<void> {
		await super.deleteOccurrence(id);
		await this.persist();
	}

	override async trashWork(workId: string, deletedAt: string): Promise<void> {
		await super.trashWork(workId, deletedAt);
		await this.persist();
	}

	override async restoreWork(workId: string): Promise<void> {
		await super.restoreWork(workId);
		await this.persist();
	}

	override async purgeWork(workId: string): Promise<PurgeManifest> {
		const manifest = await super.purgeWork(workId);
		await this.persist();
		return manifest;
	}

	override async createLink(link: OutlineLink): Promise<void> {
		await super.createLink(link);
		await this.persist();
	}

	override async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		await super.deleteLink(fromId, toId, type);
		await this.persist();
	}

	override async replaceKnots(knots: Knot[]): Promise<void> {
		await super.replaceKnots(knots);
		await this.persist();
	}

	override async upsertAlias(alias: SearchAlias): Promise<void> {
		await super.upsertAlias(alias);
		await this.persist();
	}

	override async deleteAlias(id: string): Promise<void> {
		await super.deleteAlias(id);
		await this.persist();
	}

	override async setEmergenceFeedback(
		id: string,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		await super.setEmergenceFeedback(id, action);
		await this.persist();
	}

	override async upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		await super.upsertEmergenceSuggestion(suggestion);
		await this.persist();
	}

	override async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		const before = structuredClone({
			emergenceSuggestions: this.emergenceSuggestions,
			links: this.links,
		});
		try {
			await super.resolveEmergenceSuggestion(id, action, link, reason);
			await this.persist();
		} catch (cause) {
			this.emergenceSuggestions = before.emergenceSuggestions;
			this.links = before.links;
			throw cause;
		}
	}

	override async upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		await super.upsertSavedRuleQuery(query);
		await this.persist();
	}

	override async deleteSavedRuleQuery(id: string): Promise<void> {
		await super.deleteSavedRuleQuery(id);
		await this.persist();
	}

	private readVersioned(
		parsed: BackupV1 | BackupV2 | BackupV3 | BackupV4 | BackupV5 | BackupV6,
	): StoredGraphV6 {
		if (parsed.format !== "radiora-backup") {
			throw new Error(`Unsupported backup format: ${String(parsed.format)}`);
		}
		if (parsed.schemaVersion === 1) {
			return migrateBackupV5(
				migrateBackupV4(migrateBackupV3(migrateBackupV2(migrateBackupV1(parsed.data)))),
			);
		}
		if (parsed.schemaVersion === 2) {
			return migrateBackupV5(migrateBackupV4(migrateBackupV3(migrateBackupV2(parsed.data))));
		}
		if (parsed.schemaVersion === 3) {
			return migrateBackupV5(migrateBackupV4(migrateBackupV3(parsed.data)));
		}
		if (parsed.schemaVersion === 4) return migrateBackupV5(migrateBackupV4(parsed.data));
		if (parsed.schemaVersion === 5) return migrateBackupV5(parsed.data);
		if (parsed.schemaVersion !== 6) {
			throw new Error(
				`Unsupported backup schema version: ${
					String((parsed as { schemaVersion: unknown }).schemaVersion)
				}`,
			);
		}
		return parsed.data;
	}

	private load(data: StoredGraphV6): void {
		this.works = data.works ?? [];
		this.branches = data.branches ?? [];
		this.workingCopies = data.workingCopies ?? [];
		this.occurrences = data.occurrences ?? [];
		this.links = data.links ?? [];
		this.systemRelations = data.systemRelations ?? [];
		this.knots = data.knots ?? [];
		this.aliases = data.aliases ?? [];
		this.emergenceFeedback = data.emergenceFeedback ?? {};
		this.emergenceSuggestions = data.emergenceSuggestions ?? [];
		this.savedRuleQueries = data.savedRuleQueries ?? [];
		this.purgeManifests = data.purgeManifests ?? [];
		this.revisions = data.revisions ?? [];
		this.recoverySnapshots = data.recoverySnapshots ?? [];
		this.bookmarks = data.bookmarks ?? [];
		this.resumePosition = data.resumePosition ?? null;
	}

	private async persist(): Promise<void> {
		const backup = this.currentBackup(await this.exportGraphState());
		await Deno.writeTextFile(this.path, JSON.stringify(backup, null, 2));
	}

	private currentBackup(data: GraphStateSnapshot): BackupV6 {
		return {
			format: "radiora-backup",
			schemaVersion: 6,
			exportedAt: new Date().toISOString(),
			appVersion: "0.1.0",
			source: { storageSchemaVersion: 6 },
			data,
		};
	}

	private captureAllState() {
		return structuredClone({
			works: this.works,
			branches: this.branches,
			workingCopies: this.workingCopies,
			revisions: this.revisions,
			recoverySnapshots: this.recoverySnapshots,
			bookmarks: this.bookmarks,
			resumePosition: this.resumePosition,
			occurrences: this.occurrences,
			links: this.links,
			systemRelations: this.systemRelations,
			aliases: this.aliases,
			emergenceSuggestions: this.emergenceSuggestions,
		});
	}

	private restoreAllState(state: ReturnType<JsonGraphStore["captureAllState"]>): void {
		Object.assign(this, state);
	}

	private captureRecoveryMutationState() {
		return structuredClone({
			works: this.works,
			branches: this.branches,
			workingCopies: this.workingCopies,
			revisions: this.revisions,
			recoverySnapshots: this.recoverySnapshots,
		});
	}

	private restoreRecoveryMutationState(
		state: ReturnType<JsonGraphStore["captureRecoveryMutationState"]>,
	): void {
		this.works = state.works;
		this.branches = state.branches;
		this.workingCopies = state.workingCopies;
		this.revisions = state.revisions;
		this.recoverySnapshots = state.recoverySnapshots;
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
