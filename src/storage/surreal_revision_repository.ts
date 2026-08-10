import { RecordId } from "surrealdb";
import type { Branch, RecoverySnapshot, Revision, WorkingCopy } from "../domain/models.ts";
import type { WorkStorePort } from "./graph_store.ts";
import { validateRevisionCreation } from "./graph_store.ts";
import {
	recoveryPromotionTransactionQuery,
	recoveryRestoreTransactionQuery,
} from "./surreal_queries.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import {
	branchFromRow,
	recoverySnapshotFromRow,
	revisionFromRow,
	type SurrealRow as Row,
	workingCopyFromRow,
} from "./surreal_row_mapper.ts";

export type SurrealRevisionRepositoryPort = Pick<
	WorkStorePort,
	| "listBranches"
	| "listWorkingCopies"
	| "listRevisions"
	| "listRecoverySnapshots"
	| "createBranch"
	| "updateBranch"
	| "updateBranchWorkingCopy"
	| "updateWorkingCopy"
	| "createRevision"
	| "createRecoverySnapshot"
	| "applyRecoverySnapshot"
	| "restoreRecoverySnapshot"
	| "promoteRecoverySnapshot"
>;

export class SurrealRevisionRepository implements SurrealRevisionRepositoryPort {
	constructor(private readonly db: SurrealQueryClient) {}

	async listBranches(workId?: string): Promise<Branch[]> {
		const variables = workId ? { work: new RecordId("work", workId) } : undefined;
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id, name,
				head_revision, created_at, promoted_at, archived_at
				FROM branch ${workId ? "WHERE work = $work" : ""};`,
			variables,
		);
		return rows.map(branchFromRow);
	}

	async listWorkingCopies(workId?: string): Promise<WorkingCopy[]> {
		const rows = await this.listWorkingCopyRows(workId);
		return rows.map(workingCopyFromRow);
	}

	async listRevisions(workId?: string): Promise<Revision[]> {
		const rows = await this.listRevisionRows(workId);
		return rows.map(revisionFromRow);
	}

	async listRecoverySnapshots(
		workId?: string,
		branchId?: string,
	): Promise<RecoverySnapshot[]> {
		const conditions = [
			workId ? "work = $work" : "",
			branchId ? "branch = $branch" : "",
		].filter(Boolean);
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id,
				record::id(branch) AS branch_id, text, content_hash, created_at,
				source_revision, name, protection_reason, protected_at, protection_expires_at
				FROM recovery_snapshot ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
				ORDER BY created_at;`,
			{
				...(workId ? { work: new RecordId("work", workId) } : {}),
				...(branchId ? { branch: new RecordId("branch", branchId) } : {}),
			},
		);
		return rows.map(recoverySnapshotFromRow);
	}

	async createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		if (branch.id !== workingCopy.branchId || branch.workId !== workingCopy.workId) {
			throw new Error("Branch and Working Copy identity must match");
		}
		await this.db.query(
			`BEGIN TRANSACTION;
			CREATE $branch CONTENT {
				work: $work, name: $name, head_revision: ${branch.headRevisionId ? "$head" : "NONE"},
				created_at: $createdAt, promoted_at: ${branch.promotedAt ? "$promotedAt" : "NONE"},
				archived_at: ${branch.archivedAt ? "$archivedAt" : "NONE"}
			};
			CREATE $copy CONTENT {
				work: $work, branch: $branch, text: $text, updated_at: $updatedAt
			};
			COMMIT TRANSACTION;`,
			{
				...branch,
				...workingCopy,
				branch: new RecordId("branch", branch.id),
				copy: new RecordId("working_copy", branch.id),
				work: new RecordId("work", branch.workId),
				...(branch.headRevisionId ? { head: new RecordId("revision", branch.headRevisionId) } : {}),
			},
		);
	}

	async updateBranch(branch: Branch): Promise<void> {
		await this.db.query(
			`UPDATE $branch CONTENT {
				work: $work, name: $name, head_revision: ${branch.headRevisionId ? "$head" : "NONE"},
				created_at: $createdAt, promoted_at: ${branch.promotedAt ? "$promotedAt" : "NONE"},
				archived_at: ${branch.archivedAt ? "$archivedAt" : "NONE"}
			};`,
			{
				...branch,
				branch: new RecordId("branch", branch.id),
				work: new RecordId("work", branch.workId),
				...(branch.headRevisionId ? { head: new RecordId("revision", branch.headRevisionId) } : {}),
			},
		);
	}

	async updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		const copy = (await this.listWorkingCopies()).find((candidate) =>
			candidate.branchId === branchId
		);
		if (!copy) throw new Error(`Working Copy not found for Branch: ${branchId}`);
		const branch = new RecordId("branch", branchId);
		await this.db.query(
			`UPDATE working_copy SET text = $text, updated_at = $updatedAt WHERE branch = $branch;
			UPDATE $work SET updated_at = $updatedAt;`,
			{ branch, work: new RecordId("work", copy.workId), text, updatedAt },
		);
	}

	async updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		const main = (await this.listBranches(workId)).find((branch) => branch.name === "main");
		if (!main) throw new Error(`Main Branch not found for Work: ${workId}`);
		await this.updateBranchWorkingCopy(main.id, text, updatedAt);
	}

	async createRevision(revision: Revision, branchId: string): Promise<void> {
		const [branches, revisions] = await Promise.all([
			this.listBranches(),
			this.listRevisions(),
		]);
		const branch = branches.find((candidate) => candidate.id === branchId);
		validateRevisionCreation(revision, branch, revisions);
		const message = revision.message ? "$message" : "NONE";
		await this.db.query(
			`BEGIN TRANSACTION;
			CREATE $revision CONTENT {
				work: $work, text: $text, parent_revisions: $parents, kind: $kind,
				created_at: $createdAt, message: ${message}
			};
			UPDATE $branch SET head_revision = $revision;
			COMMIT TRANSACTION;`,
			{
				...revision,
				revision: new RecordId("revision", revision.id),
				work: new RecordId("work", revision.workId),
				branch: new RecordId("branch", branchId),
				parents: revision.parentRevisionIds.map((id) => new RecordId("revision", id)),
			},
		);
	}

	async createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		const copy = (await this.listWorkingCopies(snapshot.workId)).find((candidate) =>
			candidate.branchId === snapshot.branchId
		);
		if (!copy) {
			throw new Error(`Working Copy not found for Snapshot: ${snapshot.branchId}`);
		}
		await this.db.query(
			`CREATE $snapshot CONTENT {
				work: $work, branch: $branch, text: $text, content_hash: $contentHash,
				created_at: $createdAt,
				source_revision: ${snapshot.sourceRevisionId ? "$sourceRevision" : "NONE"},
				name: ${snapshot.name ? "$name" : "NONE"},
				protection_reason: ${snapshot.protection ? "$protectionReason" : "NONE"},
				protected_at: ${snapshot.protection ? "$protectedAt" : "NONE"},
				protection_expires_at: ${snapshot.protection?.expiresAt ? "$expiresAt" : "NONE"}
			};`,
			{
				...snapshot,
				snapshot: new RecordId("recovery_snapshot", snapshot.id),
				work: new RecordId("work", snapshot.workId),
				branch: new RecordId("branch", snapshot.branchId),
				...(snapshot.sourceRevisionId
					? { sourceRevision: new RecordId("revision", snapshot.sourceRevisionId) }
					: {}),
				...(snapshot.protection
					? {
						protectionReason: snapshot.protection.reason,
						protectedAt: snapshot.protection.protectedAt,
						expiresAt: snapshot.protection.expiresAt,
					}
					: {}),
			},
		);
	}

	async applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		const snapshots = await this.listRecoverySnapshots();
		const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
		if (!snapshot) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
		await this.updateBranchWorkingCopy(snapshot.branchId, snapshot.text, updatedAt);
	}

	async restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		const [snapshots, copies] = await Promise.all([
			this.listRecoverySnapshots(),
			this.listWorkingCopies(),
		]);
		const target = snapshots.find((candidate) => candidate.id === snapshotId);
		if (!target) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
		const copy = copies.find((candidate) => candidate.branchId === target.branchId);
		if (
			!copy || copy.workId !== target.workId ||
			beforeRestore.workId !== target.workId ||
			beforeRestore.branchId !== target.branchId
		) {
			throw new Error("Recovery Snapshot scope does not match Working Copy");
		}
		if (snapshots.some((candidate) => candidate.id === beforeRestore.id)) {
			throw new Error(`Recovery Snapshot already exists: ${beforeRestore.id}`);
		}
		if (beforeRestore.text !== copy.text) {
			throw new Error("Recovery Snapshot does not capture current Working Copy");
		}
		await this.db.query(
			recoveryRestoreTransactionQuery(
				beforeRestore.sourceRevisionId !== null,
				beforeRestore.name !== undefined,
			),
			{
				beforeRestore: new RecordId("recovery_snapshot", beforeRestore.id),
				work: new RecordId("work", target.workId),
				branch: new RecordId("branch", target.branchId),
				beforeText: beforeRestore.text,
				contentHash: beforeRestore.contentHash,
				createdAt: beforeRestore.createdAt,
				targetText: target.text,
				updatedAt,
				...(beforeRestore.sourceRevisionId
					? { sourceRevision: new RecordId("revision", beforeRestore.sourceRevisionId) }
					: {}),
				...(beforeRestore.name ? { name: beforeRestore.name } : {}),
			},
		);
	}

	async promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		const [snapshots, branches, revisions] = await Promise.all([
			this.listRecoverySnapshots(),
			this.listBranches(),
			this.listRevisions(),
		]);
		const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
		const branch = branches.find((candidate) => candidate.id === branchId);
		if (!snapshot) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
		if (
			snapshot.branchId !== branchId || snapshot.workId !== revision.workId ||
			branch?.workId !== snapshot.workId || revision.text !== snapshot.text
		) {
			throw new Error("Recovery Snapshot scope does not match Revision");
		}
		validateRevisionCreation(revision, branch, revisions);
		await this.db.query(
			recoveryPromotionTransactionQuery(revision.message !== undefined),
			{
				...revision,
				revision: new RecordId("revision", revision.id),
				work: new RecordId("work", revision.workId),
				branch: new RecordId("branch", branchId),
				snapshot: new RecordId("recovery_snapshot", snapshotId),
				parents: revision.parentRevisionIds.map((id) => new RecordId("revision", id)),
				protectedAt,
			},
		);
	}

	private async listWorkingCopyRows(workId?: string): Promise<Row[]> {
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(work) AS work_id, record::id(branch) AS branch_id,
				text, updated_at FROM working_copy ${workId ? "WHERE work = $work" : ""};`,
			workId ? { work: new RecordId("work", workId) } : undefined,
		);
		return rows;
	}

	private async listRevisionRows(workId?: string): Promise<Row[]> {
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id, text,
				parent_revisions, kind, created_at, message
				FROM revision ${workId ? "WHERE work = $work" : ""};`,
			workId ? { work: new RecordId("work", workId) } : undefined,
		);
		return rows;
	}
}
