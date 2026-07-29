import type { RecoverySnapshot, Revision, WorkingCopy } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";
import { diffText, type RevisionDiffNode } from "./revision_diff.ts";

export interface RecoverySnapshotPreview {
	snapshot: RecoverySnapshot;
	workingCopy: WorkingCopy;
	diff: RevisionDiffNode[];
}

export interface RecoverySnapshotServiceOptions {
	now?: () => string;
	createId?: () => string;
}

export class RecoverySnapshotService {
	readonly #now: () => string;
	readonly #createId: () => string;

	constructor(
		private readonly store: GraphStore,
		options: RecoverySnapshotServiceOptions = {},
	) {
		this.#now = options.now ?? (() => new Date().toISOString());
		this.#createId = options.createId ?? (() => crypto.randomUUID());
	}

	async list(workId: string, branchId: string): Promise<RecoverySnapshot[]> {
		if (!workId || !branchId) return [];
		await this.requireScope(workId, branchId);
		return (await this.store.listRecoverySnapshots(workId, branchId)).sort((left, right) =>
			right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
		);
	}

	async preview(
		snapshotId: string,
		workId: string,
		branchId: string,
	): Promise<RecoverySnapshotPreview> {
		const { snapshot, workingCopy } = await this.requireSnapshotScope(
			snapshotId,
			workId,
			branchId,
		);
		return {
			snapshot,
			workingCopy,
			diff: diffText(workingCopy.text, snapshot.text),
		};
	}

	async restore(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
	): Promise<RecoverySnapshot | null> {
		if (confirmation === "cancelled") return null;
		if (confirmation !== "confirmed") throw new Error("Explicit confirmation is required");
		const { snapshot, workingCopy, branch } = await this.requireSnapshotScope(
			snapshotId,
			workId,
			branchId,
		);
		const createdAt = this.#now();
		const beforeRestore: RecoverySnapshot = {
			id: this.#createId(),
			workId,
			branchId,
			text: workingCopy.text,
			contentHash: await contentHash(workingCopy.text),
			createdAt,
			sourceRevisionId: branch.headRevisionId,
			name: "復元前",
		};
		await this.store.restoreRecoverySnapshot(snapshot.id, beforeRestore, createdAt);
		return beforeRestore;
	}

	async promote(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
		message?: string,
	): Promise<Revision | null> {
		if (confirmation === "cancelled") return null;
		if (confirmation !== "confirmed") throw new Error("Explicit confirmation is required");
		const { snapshot, branch } = await this.requireSnapshotScope(snapshotId, workId, branchId);
		const revisions = await this.store.listRevisions(workId);
		const revisionIds = new Set(revisions.map((revision) => revision.id));
		// A Snapshot's capture-time source is the most faithful parent. Legacy or
		// imported snapshots can lack it; in that case the current Branch head is
		// the safe append-only fallback.
		const parentId = snapshot.sourceRevisionId &&
				revisionIds.has(snapshot.sourceRevisionId)
			? snapshot.sourceRevisionId
			: branch.headRevisionId && revisionIds.has(branch.headRevisionId)
			? branch.headRevisionId
			: null;
		const createdAt = this.#now();
		const revision: Revision = {
			id: this.#createId(),
			workId,
			text: snapshot.text,
			parentRevisionIds: parentId ? [parentId] : [],
			kind: "edition",
			createdAt,
			...(message?.trim() ? { message: message.trim() } : {}),
		};
		await this.store.promoteRecoverySnapshot(snapshot.id, revision, branch.id, createdAt);
		return revision;
	}

	private async requireScope(workId: string, branchId: string) {
		const [branches, copies] = await Promise.all([
			this.store.listBranches(workId),
			this.store.listWorkingCopies(workId),
		]);
		const branch = branches.find((candidate) => candidate.id === branchId);
		const workingCopy = copies.find((candidate) => candidate.branchId === branchId);
		if (!branch || !workingCopy || branch.workId !== workId || workingCopy.workId !== workId) {
			throw new Error("Recovery Snapshot scope does not match selected Work and Branch");
		}
		return { branch, workingCopy };
	}

	private async requireSnapshotScope(snapshotId: string, workId: string, branchId: string) {
		if (!snapshotId || !workId || !branchId) {
			throw new Error("Recovery Snapshot, Work, and Branch are required");
		}
		const { branch, workingCopy } = await this.requireScope(workId, branchId);
		const snapshot = (await this.store.listRecoverySnapshots(workId, branchId))
			.find((candidate) => candidate.id === snapshotId);
		if (!snapshot || snapshot.workId !== workId || snapshot.branchId !== branchId) {
			throw new Error("Recovery Snapshot scope does not match selected Work and Branch");
		}
		return { snapshot, branch, workingCopy };
	}
}

async function contentHash(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${
		[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
	}`;
}
