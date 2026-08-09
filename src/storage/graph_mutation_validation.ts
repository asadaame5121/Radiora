import type {
	Branch,
	Occurrence,
	Revision,
	StubCreationKind,
	Work,
	WorkingCopy,
	WorkStub,
} from "../domain/models.ts";
import type { WorkBundle } from "./graph_store.ts";

function isIsoInstant(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validateWorkBundleImport(
	bundles: readonly WorkBundle[],
	existing: {
		works: readonly Work[];
		branches: readonly Branch[];
		workingCopies: readonly WorkingCopy[];
		occurrences: readonly Occurrence[];
	},
): void {
	if (bundles.length === 0) throw new Error("Outline import contains no items");
	const workIds = new Set(existing.works.map((entry) => entry.id));
	const branchIds = new Set(existing.branches.map((entry) => entry.id));
	const copyBranchIds = new Set(existing.workingCopies.map((entry) => entry.branchId));
	const occurrenceIds = new Set(existing.occurrences.map((entry) => entry.id));
	const importedOccurrenceIds = new Set(bundles.map((bundle) => bundle.occurrence.id));

	for (const { work, branch, workingCopy, occurrence } of bundles) {
		requireFreshId(work.id, workIds, "Work");
		requireFreshId(branch.id, branchIds, "Branch");
		requireFreshId(workingCopy.branchId, copyBranchIds, "Working Copy");
		requireFreshId(occurrence.id, occurrenceIds, "Occurrence");
		if (
			branch.workId !== work.id || branch.name !== "main" ||
			workingCopy.workId !== work.id || workingCopy.branchId !== branch.id ||
			occurrence.workId !== work.id ||
			occurrence.revisionSelector.mode !== "branch" ||
			occurrence.revisionSelector.branchId !== branch.id
		) {
			throw new Error(`Invalid imported Work bundle: ${work.id}`);
		}
		const parentId = occurrence.parentOccurrenceId;
		if (
			parentId === occurrence.id ||
			(parentId !== null && !occurrenceIds.has(parentId) && !importedOccurrenceIds.has(parentId))
		) {
			throw new Error(`Imported parent Occurrence not found: ${parentId}`);
		}
	}

	const parentById = new Map(
		bundles.map((bundle) => [bundle.occurrence.id, bundle.occurrence.parentOccurrenceId]),
	);
	for (const start of parentById.keys()) {
		const path = new Set<string>();
		let cursor: string | null | undefined = start;
		while (cursor && parentById.has(cursor)) {
			if (path.has(cursor)) throw new Error(`Imported Occurrence cycle: ${cursor}`);
			path.add(cursor);
			cursor = parentById.get(cursor);
		}
	}
}

function requireFreshId(id: string, ids: Set<string>, label: string): void {
	if (!id || ids.has(id)) throw new Error(`${label} ID collision: ${id}`);
	ids.add(id);
}

const STUB_CREATION_KINDS: readonly StubCreationKind[] = ["stub-list", "advanced-link-editor"];

/**
 * A blank Working Copy is accepted only for an explicitly recorded Stub:
 * a valid ISO creation instant and a known creation path are both required.
 */
export function isValidWorkStub(stub: WorkStub | undefined): boolean {
	if (!stub) return false;
	const parsedCreatedAt = Date.parse(stub.createdAt);
	if (
		!Number.isFinite(parsedCreatedAt) || new Date(parsedCreatedAt).toISOString() !== stub.createdAt
	) {
		return false;
	}
	return (STUB_CREATION_KINDS as readonly string[]).includes(stub.createdVia);
}

export function validateUnplacedWorkCreation(
	work: Work,
	branch: Branch,
	workingCopy: WorkingCopy,
	existingWorks: readonly Work[],
	existingBranches: readonly Branch[],
	existingWorkingCopies: readonly WorkingCopy[],
): void {
	if (!work.id || !branch.id) throw new Error("Work and Branch IDs are required");
	if (!workingCopy.text.trim() && !isValidWorkStub(work.stub)) {
		throw new Error("Quick Capture text must not be blank");
	}
	if (
		branch.workId !== work.id || workingCopy.workId !== work.id ||
		workingCopy.branchId !== branch.id
	) {
		throw new Error("Work, Branch, and Working Copy identity must match");
	}
	if (
		branch.name !== "main" || branch.headRevisionId !== null || branch.promotedAt ||
		branch.archivedAt
	) {
		throw new Error("Quick Capture requires an active main Branch without a Revision");
	}
	const parsedCreatedAt = Date.parse(work.createdAt);
	if (
		!Number.isFinite(parsedCreatedAt) || new Date(parsedCreatedAt).toISOString() !== work.createdAt
	) {
		throw new Error("Quick Capture requires a valid ISO creation instant");
	}
	if (
		work.deletedAt || work.createdAt !== work.updatedAt ||
		branch.createdAt !== work.createdAt || workingCopy.updatedAt !== work.updatedAt
	) {
		throw new Error("Quick Capture timestamps must describe one new active Work");
	}
	if (existingWorks.some((candidate) => candidate.id === work.id)) {
		throw new Error(`Work already exists: ${work.id}`);
	}
	if (existingBranches.some((candidate) => candidate.id === branch.id)) {
		throw new Error(`Branch already exists: ${branch.id}`);
	}
	if (existingWorkingCopies.some((candidate) => candidate.branchId === workingCopy.branchId)) {
		throw new Error(`Working Copy already exists for Branch: ${workingCopy.branchId}`);
	}
}

/**
 * Validates the append-only Revision boundary.
 *
 * Revisions are immutable after creation, and every parent must already exist.
 * Therefore accepting a new Revision through this boundary cannot introduce a
 * cycle: a new node can only point to nodes that predate it.
 */
export function validateRevisionCreation(
	revision: Revision,
	branch: Branch | undefined,
	existingRevisions: readonly Revision[],
): void {
	if (!branch || branch.workId !== revision.workId) {
		throw new Error(`Branch does not belong to Revision Work: ${branch?.id ?? "unknown"}`);
	}
	if (existingRevisions.some((candidate) => candidate.id === revision.id)) {
		throw new Error(`Revision already exists: ${revision.id}`);
	}
	if (revision.parentRevisionIds.includes(revision.id)) {
		throw new Error(`Revision cannot be its own parent: ${revision.id}`);
	}
	if (new Set(revision.parentRevisionIds).size !== revision.parentRevisionIds.length) {
		throw new Error(`Revision parents must be unique: ${revision.id}`);
	}

	const revisionsById = new Map(existingRevisions.map((candidate) => [candidate.id, candidate]));
	for (const parentId of revision.parentRevisionIds) {
		const parent = revisionsById.get(parentId);
		if (!parent) {
			throw new Error(`Parent Revision not found: ${parentId}`);
		}
		if (parent.workId !== revision.workId) {
			throw new Error(`Parent Revision does not belong to Revision Work: ${parentId}`);
		}
	}
}
