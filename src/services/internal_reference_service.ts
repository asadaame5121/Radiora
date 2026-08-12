import type { NavigationTarget, Revision } from "../domain/models.ts";
import type { OutlineStorePort, WorkStorePort } from "../storage/graph_store.ts";
import {
	parseMarkdownCandidates,
	type RadioraInternalReferenceCandidate,
	type RadioraReferenceScope,
} from "./markdown_parser.ts";
import { canonicalInternalReferenceMarkdown } from "./internal_reference.ts";
import {
	EMPTY_REVISION_DISPLAY_NAME,
	EMPTY_WORK_DISPLAY_NAME,
} from "./internal_reference_display.ts";
import { normalizeSearchText, titleFromText } from "./search_text.ts";

export type InternalReferenceStatus =
	| "resolved"
	| "missing"
	| "deleted"
	| "scope-mismatch";

type InternalReferenceStore = OutlineStorePort & WorkStorePort;

export interface InternalReferenceCompletion {
	scope: RadioraReferenceScope;
	id: string;
	workId: string;
	displayName: string;
	isEmpty: boolean;
	scopeLabel: string;
	shortId: string;
	canonicalMarkdown: string;
}

export interface InternalReferenceResolution {
	reference: RadioraInternalReferenceCandidate;
	status: InternalReferenceStatus;
	displayName?: string;
	reason?: string;
	workId?: string;
	revision?: Revision;
	navigationTarget?: NavigationTarget;
}

export type InternalReferenceBacklinkSource =
	| { scope: "work"; workId: string; branchId: string }
	| { scope: "revision"; workId: string; revisionId: string };

export interface InternalReferenceBacklink {
	source: InternalReferenceBacklinkSource;
	displayName: string;
	count: number;
	references: RadioraInternalReferenceCandidate[];
}

export class InternalReferenceService {
	constructor(private readonly store: InternalReferenceStore) {}

	async listCompletions(query = "", limit = 50): Promise<InternalReferenceCompletion[]> {
		const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
		const [works, branches, copies, revisions] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
		]);
		const activeWorkIds = new Set(works.map((work) => work.id));
		const completions: InternalReferenceCompletion[] = works.map((work) => {
			const display = workCompletionDisplay(work.id, branches, copies);
			return this.completion("work", work.id, work.id, display.displayName, display.isEmpty);
		});
		for (const revision of revisions) {
			if (!activeWorkIds.has(revision.workId)) continue;
			const displayName = titleFromText(revision.text) || EMPTY_REVISION_DISPLAY_NAME;
			completions.push(this.completion(
				"revision",
				revision.id,
				revision.workId,
				displayName,
				!titleFromText(revision.text),
			));
		}
		const normalizedQuery = normalizeSearchText(query);
		return completions
			.filter((candidate) =>
				!normalizedQuery ||
				normalizeSearchText(
					`${candidate.displayName} ${candidate.scope} ${candidate.id} ${candidate.workId}`,
				).includes(normalizedQuery)
			)
			.sort((left, right) =>
				left.displayName.localeCompare(right.displayName, "ja") ||
				left.scope.localeCompare(right.scope) || left.id.localeCompare(right.id)
			)
			.slice(0, safeLimit);
	}

	async resolve(markdown: string): Promise<InternalReferenceResolution[]> {
		const references = parseMarkdownCandidates(markdown).internalReferences;
		if (!references.length) return [];
		const [works, revisions, occurrences, branches, copies] = await Promise.all([
			this.store.listWorks(true),
			this.store.listRevisions(),
			this.store.listOccurrences(true),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
		]);
		const workById = new Map(works.map((work) => [work.id, work]));
		const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
		return references.map((reference) => {
			if (reference.scope === "work") {
				const work = workById.get(reference.id);
				if (work?.deletedAt) {
					return { reference, status: "deleted", reason: "参照先の項目は削除されています。" };
				}
				if (work) {
					return {
						reference,
						status: "resolved",
						displayName: activeMainTitle(work.id, branches, copies),
						workId: work.id,
						navigationTarget: navigationTarget(work.id, occurrences),
					};
				}
				if (revisionById.has(reference.id)) {
					return {
						reference,
						status: "scope-mismatch",
						reason: "版IDが項目参照として指定されています。",
					};
				}
				return { reference, status: "missing", reason: "参照先の項目が見つかりません。" };
			}
			const revision = revisionById.get(reference.id);
			if (!revision) {
				if (workById.has(reference.id)) {
					return {
						reference,
						status: "scope-mismatch",
						reason: "項目IDが版参照として指定されています。",
					};
				}
				return { reference, status: "missing", reason: "参照先の版が見つかりません。" };
			}
			const owner = workById.get(revision.workId);
			if (!owner) {
				return { reference, status: "missing", reason: "版を所有する項目が見つかりません。" };
			}
			if (owner.deletedAt) {
				return {
					reference,
					status: "deleted",
					reason: "版を所有する項目は削除されています。",
				};
			}
			return {
				reference,
				status: "resolved",
				displayName: titleFromText(revision.text) || EMPTY_REVISION_DISPLAY_NAME,
				workId: revision.workId,
				revision,
				navigationTarget: navigationTarget(revision.workId, occurrences),
			};
		});
	}

	async listBacklinks(
		scope: RadioraReferenceScope,
		id: string,
	): Promise<InternalReferenceBacklink[]> {
		const [works, branches, copies, revisions] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
		]);
		const activeWorkIds = new Set(works.map((work) => work.id));
		const activeBranches = new Set(
			branches.filter((branch) => !branch.archivedAt && activeWorkIds.has(branch.workId))
				.map((branch) => branch.id),
		);
		const result: InternalReferenceBacklink[] = [];
		for (const copy of copies) {
			if (!activeBranches.has(copy.branchId)) continue;
			const matches = matchingReferences(copy.text, scope, id);
			if (matches.length) {
				result.push({
					source: {
						scope: "work",
						workId: copy.workId,
						branchId: copy.branchId,
					},
					displayName: titleFromText(copy.text) || EMPTY_WORK_DISPLAY_NAME,
					count: matches.length,
					references: matches,
				});
			}
		}
		for (const revision of revisions) {
			if (!activeWorkIds.has(revision.workId)) continue;
			const matches = matchingReferences(revision.text, scope, id);
			if (matches.length) {
				result.push({
					source: {
						scope: "revision",
						workId: revision.workId,
						revisionId: revision.id,
					},
					displayName: titleFromText(revision.text) || EMPTY_REVISION_DISPLAY_NAME,
					count: matches.length,
					references: matches,
				});
			}
		}
		return result.sort((left, right) =>
			left.displayName.localeCompare(right.displayName, "ja") ||
			left.source.scope.localeCompare(right.source.scope)
		);
	}

	private completion(
		scope: RadioraReferenceScope,
		id: string,
		workId: string,
		displayName: string,
		isEmpty: boolean,
	): InternalReferenceCompletion {
		return {
			scope,
			id,
			workId,
			displayName,
			isEmpty,
			scopeLabel: scope === "work" ? "項目" : "固定版",
			shortId: id.slice(0, 8),
			canonicalMarkdown: canonicalInternalReferenceMarkdown(displayName, scope, id),
		};
	}
}

function workCompletionDisplay(
	workId: string,
	branches: Awaited<ReturnType<WorkStorePort["listBranches"]>>,
	copies: Awaited<ReturnType<WorkStorePort["listWorkingCopies"]>>,
): { displayName: string; isEmpty: boolean } {
	const mainTitle = activeMainTitle(workId, branches, copies);
	if (mainTitle !== EMPTY_WORK_DISPLAY_NAME) return { displayName: mainTitle, isEmpty: false };
	const activeBranchIds = new Set(
		branches.filter((branch) => branch.workId === workId && !branch.archivedAt).map((branch) =>
			branch.id
		),
	);
	const alternateTitle = copies
		.filter((copy) => copy.workId === workId && activeBranchIds.has(copy.branchId))
		.map((copy) => titleFromText(copy.text))
		.find(Boolean);
	return alternateTitle
		? { displayName: alternateTitle, isEmpty: false }
		: { displayName: EMPTY_WORK_DISPLAY_NAME, isEmpty: true };
}

function matchingReferences(
	text: string,
	scope: RadioraReferenceScope,
	id: string,
): RadioraInternalReferenceCandidate[] {
	return parseMarkdownCandidates(text).internalReferences.filter((reference) =>
		reference.scope === scope && reference.id === id
	);
}

function activeMainTitle(
	workId: string,
	branches: Awaited<ReturnType<WorkStorePort["listBranches"]>>,
	copies: Awaited<ReturnType<WorkStorePort["listWorkingCopies"]>>,
): string {
	const mains = branches.filter((branch) =>
		branch.workId === workId && branch.name === "main" && !branch.archivedAt
	);
	if (mains.length !== 1) {
		throw new Error(`Expected one active main Branch for Work: ${workId}`);
	}
	const matchingCopies = copies.filter((copy) =>
		copy.workId === workId && copy.branchId === mains[0].id
	);
	if (matchingCopies.length !== 1) {
		throw new Error(`Expected one Working Copy for active main Branch: ${mains[0].id}`);
	}
	return titleFromText(matchingCopies[0].text) || EMPTY_WORK_DISPLAY_NAME;
}

function navigationTarget(
	workId: string,
	occurrences: Awaited<ReturnType<OutlineStorePort["listOccurrences"]>>,
): NavigationTarget {
	const active = occurrences.filter((occurrence) => occurrence.workId === workId)
		.sort((left, right) => left.orderKey - right.orderKey || left.id.localeCompare(right.id));
	const target = active[0];
	if (!target) return { kind: "work", workId, fellBack: true };
	const byId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
	const ancestorOccurrenceIds: string[] = [];
	const seen = new Set([target.id]);
	let parentId = target.parentOccurrenceId;
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		const parent = byId.get(parentId);
		if (!parent) break;
		ancestorOccurrenceIds.unshift(parent.id);
		parentId = parent.parentOccurrenceId;
	}
	return {
		kind: "occurrence",
		workId,
		occurrenceId: target.id,
		ancestorOccurrenceIds,
		fellBack: true,
	};
}
