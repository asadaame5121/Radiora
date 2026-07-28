import type {
	Branch,
	Knot,
	LinkType,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { MemoryGraphStore } from "./memory_store.ts";

interface LegacyItem {
	id: string;
	text: string;
	parentId: string | null;
	orderKey: number;
	collapsed: boolean;
	createdAt: string;
	updatedAt: string;
}

interface LegacyLink {
	fromId: string;
	toId: string;
	type: "LIKE" | "FIX" | "VS" | "IN";
	createdAt: string;
}

interface BackupV0 {
	items: LegacyItem[];
	links: LegacyLink[];
	knots: Knot[];
	aliases?: SearchAlias[];
	emergenceFeedback?: Record<string, "accept" | "dismiss" | "pin">;
	savedRuleQueries?: SavedRuleQuery[];
}

export interface StoredGraphV1 {
	works: Work[];
	branches: Branch[];
	workingCopies: WorkingCopy[];
	occurrences: Occurrence[];
	links: OutlineLink[];
	systemRelations: SystemRelation[];
	knots: Knot[];
	aliases: SearchAlias[];
	emergenceFeedback: Record<string, "accept" | "dismiss" | "pin">;
	savedRuleQueries: SavedRuleQuery[];
	purgeManifests: PurgeManifest[];
}

export interface BackupV1 {
	format: "radiora-backup";
	schemaVersion: 1;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 1 };
	data: StoredGraphV1;
}

export interface StoredGraphV2 extends StoredGraphV1 {
	revisions: Revision[];
	recoverySnapshots: RecoverySnapshot[];
}

interface BackupV2 {
	format: "radiora-backup";
	schemaVersion: 2;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 2 };
	data: StoredGraphV2;
}

export function migrateBackupV1(data: StoredGraphV1): StoredGraphV2 {
	return {
		...data,
		revisions: [],
		recoverySnapshots: [],
	};
}

export function migrateBackupV0(data: BackupV0): StoredGraphV1 {
	const works: Work[] = data.items.map((item) => ({
		id: item.id,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
	}));
	const branches: Branch[] = data.items.map((item) => ({
		id: item.id,
		workId: item.id,
		name: "main",
		headRevisionId: null,
		createdAt: item.createdAt,
	}));
	const workingCopies: WorkingCopy[] = data.items.map((item) => ({
		branchId: item.id,
		workId: item.id,
		text: item.text,
		updatedAt: item.updatedAt,
	}));
	const occurrences: Occurrence[] = data.items.map((item) => ({
		id: item.id,
		workId: item.id,
		parentOccurrenceId: item.parentId,
		orderKey: item.orderKey,
		collapsed: item.collapsed,
		revisionSelector: { mode: "branch", branchId: item.id },
	}));
	const semanticLinks = data.links.filter((link) => link.type !== "IN");
	const links: OutlineLink[] = semanticLinks.map((link) => ({
		id: legacyRelationId(link),
		fromId: link.fromId,
		toId: link.toId,
		from: { scope: "work", workId: link.fromId },
		to: { scope: "work", workId: link.toId },
		type: link.type as "LIKE" | "FIX" | "VS",
		status: "asserted",
		origin: "import",
		createdAt: link.createdAt,
	}));
	const systemRelations: SystemRelation[] = data.links
		.filter((link) => link.type === "IN")
		.map((link) => ({
			id: legacyRelationId(link),
			fromWorkId: link.fromId,
			toWorkId: link.toId,
			type: "IN",
			createdAt: link.createdAt,
		}));

	return {
		works,
		branches,
		workingCopies,
		occurrences,
		links,
		systemRelations,
		knots: data.knots ?? [],
		aliases: data.aliases ?? [],
		emergenceFeedback: data.emergenceFeedback ?? {},
		savedRuleQueries: data.savedRuleQueries ?? [],
		purgeManifests: [],
	};
}

function legacyRelationId(link: LegacyLink): string {
	return `v0-${link.type.toLowerCase()}-${link.fromId}-${link.toId}`;
}

export class JsonGraphStore extends MemoryGraphStore {
	constructor(private readonly path: string | URL) {
		super();
	}

	override async initialize(): Promise<void> {
		try {
			const parsed = JSON.parse(await Deno.readTextFile(this.path)) as
				| BackupV0
				| BackupV1
				| BackupV2;
			const data = "schemaVersion" in parsed
				? this.readVersioned(parsed)
				: migrateBackupV1(migrateBackupV0(parsed));
			this.load(data);
			if (!("schemaVersion" in parsed)) {
				await this.protectVersionZeroInput();
				await this.persist();
			} else if (parsed.schemaVersion === 1) {
				await this.protectVersionOneInput();
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

	override async createOccurrence(occurrence: Occurrence): Promise<void> {
		await super.createOccurrence(occurrence);
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

	override async upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		await super.upsertSavedRuleQuery(query);
		await this.persist();
	}

	override async deleteSavedRuleQuery(id: string): Promise<void> {
		await super.deleteSavedRuleQuery(id);
		await this.persist();
	}

	private readVersioned(parsed: BackupV1 | BackupV2): StoredGraphV2 {
		if (parsed.format !== "radiora-backup") {
			throw new Error(`Unsupported backup format: ${String(parsed.format)}`);
		}
		if (parsed.schemaVersion === 1) {
			return migrateBackupV1(parsed.data);
		}
		if (parsed.schemaVersion !== 2) {
			throw new Error(
				`Unsupported backup schema version: ${
					String((parsed as { schemaVersion: unknown }).schemaVersion)
				}`,
			);
		}
		return parsed.data;
	}

	private load(data: StoredGraphV2): void {
		this.works = data.works ?? [];
		this.branches = data.branches ?? [];
		this.workingCopies = data.workingCopies ?? [];
		this.occurrences = data.occurrences ?? [];
		this.links = data.links ?? [];
		this.systemRelations = data.systemRelations ?? [];
		this.knots = data.knots ?? [];
		this.aliases = data.aliases ?? [];
		this.emergenceFeedback = data.emergenceFeedback ?? {};
		this.savedRuleQueries = data.savedRuleQueries ?? [];
		this.purgeManifests = data.purgeManifests ?? [];
		this.revisions = data.revisions ?? [];
		this.recoverySnapshots = data.recoverySnapshots ?? [];
	}

	private async persist(): Promise<void> {
		const backup: BackupV2 = {
			format: "radiora-backup",
			schemaVersion: 2,
			exportedAt: new Date().toISOString(),
			appVersion: "0.1.0",
			source: { storageSchemaVersion: 2 },
			data: {
				works: this.works,
				branches: this.branches,
				workingCopies: this.workingCopies,
				occurrences: this.occurrences,
				links: this.links,
				systemRelations: this.systemRelations,
				knots: this.knots,
				aliases: this.aliases,
				emergenceFeedback: this.emergenceFeedback,
				savedRuleQueries: this.savedRuleQueries,
				purgeManifests: this.purgeManifests,
				revisions: this.revisions,
				recoverySnapshots: this.recoverySnapshots,
			},
		};
		await Deno.writeTextFile(this.path, JSON.stringify(backup, null, 2));
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

	private async protectVersionZeroInput(): Promise<void> {
		const backup = typeof this.path === "string"
			? `${this.path}.v0.bak`
			: new URL(`${this.path.href}.v0.bak`);
		try {
			await Deno.stat(backup);
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) throw cause;
			await Deno.copyFile(this.path, backup);
		}
	}

	private async protectVersionOneInput(): Promise<void> {
		const backup = typeof this.path === "string"
			? `${this.path}.v1.bak`
			: new URL(`${this.path.href}.v1.bak`);
		try {
			await Deno.stat(backup);
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) throw cause;
			await Deno.copyFile(this.path, backup);
		}
	}
}
