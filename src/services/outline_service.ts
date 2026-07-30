import type {
	Bookmark,
	CreateItemInput,
	CreateLinkInput,
	CreateOccurrenceInput,
	EmergenceAction,
	EmergenceSuggestion,
	Knot,
	LinkEndpoint,
	LinkType,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	PurgeManifest,
	RecoverySnapshot,
	ResolvedBookmark,
	ResolvedResumePosition,
	ResumePosition,
	Revision,
	RuleQueryResult,
	SavedRuleQuery,
	ScopedTagSet,
	SearchAlias,
	SearchRequest,
	SearchResult,
	Suggestion,
	TagAlias,
	TagSearchRequest,
	TagSummary,
	TransientProjectionNode,
	TrashEntry,
	UnplacedWork,
} from "../domain/models.ts";
import { isSymmetricLinkType, LINK_TYPES } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";
import {
	BranchService,
	type GlobalLineageProjection,
	type WorkLineageProjection,
} from "./branch_service.ts";
import { normalizeSearchText, titleOf } from "./search_text.ts";
import { runRuleQuery } from "./rule_query.ts";
import { buildSparseOutline } from "./sparse_outline.ts";
import {
	type RecoverySnapshotPreview,
	RecoverySnapshotService,
} from "./recovery_snapshot_service.ts";
import { TagService } from "./tag_service.ts";
import { NavigationService } from "./navigation_service.ts";
import { type DateProjection, DateProjectionService, type DateRange } from "./date_projection.ts";
import { QuickCaptureService } from "./quick_capture_service.ts";
import {
	type AdvancedLinkResolution,
	AdvancedLinkResolverService,
	type AdvancedLinkSelections,
} from "./advanced_link_resolver.ts";
import {
	type InternalReferenceBacklink,
	type InternalReferenceCompletion,
	type InternalReferenceResolution,
	InternalReferenceService,
} from "./internal_reference_service.ts";
import type { RadioraReferenceScope } from "./markdown_parser.ts";
import {
	ComparisonService,
	type LinkComparisonProjection,
	type WorkComparisonDocuments,
} from "./comparison_service.ts";

const ORDER_STEP = 1024;
const MAX_SEARCH_LIMIT = 50;

function sameEndpoint(left: LinkEndpoint, right: LinkEndpoint): boolean {
	if (left.scope !== right.scope || left.workId !== right.workId) return false;
	return left.scope === "work" ||
		(right.scope === "revision" && left.revisionId === right.revisionId);
}

export class OutlineService {
	private readonly suggestionCache = new Map<string, EmergenceSuggestion>();

	constructor(private readonly store: GraphStore) {}

	listBookmarks(): Promise<Bookmark[]> {
		return new NavigationService(this.store).listBookmarks();
	}

	createBookmark(occurrenceId: string): Promise<Bookmark> {
		return new NavigationService(this.store).createBookmark(occurrenceId);
	}

	deleteBookmark(id: string): Promise<void> {
		return new NavigationService(this.store).deleteBookmark(id);
	}

	resolveBookmark(id: string): Promise<ResolvedBookmark> {
		return new NavigationService(this.store).resolveBookmark(id);
	}

	saveResumePosition(occurrenceId: string, caretOffset: number): Promise<ResumePosition> {
		return new NavigationService(this.store).saveResumePosition(occurrenceId, caretOffset);
	}

	resolveResumePosition(): Promise<ResolvedResumePosition | null> {
		return new NavigationService(this.store).resolveResumePosition();
	}

	clearResumePosition(): Promise<void> {
		return new NavigationService(this.store).clearResumePosition();
	}

	projectDates(range: DateRange): Promise<DateProjection> {
		return new DateProjectionService(this.store).project(range);
	}

	quickCapture(text: string): Promise<UnplacedWork> {
		return new QuickCaptureService(this.store).capture(text);
	}

	listUnplacedWorks(): Promise<UnplacedWork[]> {
		return new QuickCaptureService(this.store).list();
	}

	updateUnplacedWorkText(workId: string, text: string): Promise<void> {
		return new QuickCaptureService(this.store).updateText(workId, text);
	}

	async placeUnplacedWork(input: CreateOccurrenceInput): Promise<OutlineItem> {
		const unplaced = await this.listUnplacedWorks();
		if (!unplaced.some((candidate) => candidate.workId === input.workId)) {
			throw new Error(`Unplaced Work not found: ${input.workId}`);
		}
		return this.createOccurrence(input);
	}

	async listOutline(): Promise<OutlineSnapshot> {
		const items = await this.store.listItems();
		const knots = this.detectKnots(items);
		await this.store.replaceKnots(knots);
		const stashItemIds = [...new Set(knots.flatMap((knot) => knot.cycleIds))];
		return {
			items: this.markRecursivePlacements(items),
			links: await this.listActiveLinks(),
			knots,
			stashItemIds,
		};
	}

	async listRevisions(workId: string): Promise<Revision[]> {
		if (!workId) return [];
		const revisions = await this.store.listRevisions(workId);
		return revisions.sort((left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
		);
	}

	listRecoverySnapshots(workId: string, branchId: string): Promise<RecoverySnapshot[]> {
		return new RecoverySnapshotService(this.store).list(workId, branchId);
	}

	previewRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
	): Promise<RecoverySnapshotPreview> {
		return new RecoverySnapshotService(this.store).preview(snapshotId, workId, branchId);
	}

	restoreRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
	): Promise<RecoverySnapshot | null> {
		return new RecoverySnapshotService(this.store).restore(
			snapshotId,
			workId,
			branchId,
			confirmation,
		);
	}

	promoteRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
		message?: string,
	): Promise<Revision | null> {
		return new RecoverySnapshotService(this.store).promote(
			snapshotId,
			workId,
			branchId,
			confirmation,
			message,
		);
	}

	listGlobalLineage(): Promise<GlobalLineageProjection> {
		return new BranchService(this.store).listGlobalLineage();
	}

	listWorkLineage(workId: string): Promise<WorkLineageProjection> {
		return new BranchService(this.store).listWorkLineage(workId);
	}

	async createItem(input: CreateItemInput): Promise<OutlineItem> {
		const items = await this.store.listItems();
		const now = new Date().toISOString();
		const workId = crypto.randomUUID();
		const branchId = crypto.randomUUID();
		const occurrenceId = crypto.randomUUID();
		const occurrence = {
			id: occurrenceId,
			workId,
			parentOccurrenceId: input.parentId,
			orderKey: this.orderAfter(items, input.parentId, input.afterId ?? null),
			collapsed: false,
			revisionSelector: { mode: "branch" as const, branchId },
		};
		await this.store.createWorkBundle(
			{ id: workId, createdAt: now, updatedAt: now },
			{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: now },
			{ branchId, workId, text: input.text, updatedAt: now },
			occurrence,
		);
		return {
			id: occurrenceId,
			workId,
			text: input.text,
			parentId: input.parentId,
			orderKey: occurrence.orderKey,
			collapsed: false,
			revisionSelector: occurrence.revisionSelector,
			createdAt: now,
			updatedAt: now,
		};
	}

	async createOccurrence(input: CreateOccurrenceInput): Promise<OutlineItem> {
		const items = await this.store.listItems();
		if (input.parentId && !items.some((item) => item.id === input.parentId)) {
			throw new Error(`Parent Occurrence not found: ${input.parentId}`);
		}
		let source = items.find((item) => item.workId === input.workId);
		if (!source) {
			const work = (await this.store.listWorks()).find((candidate) =>
				candidate.id === input.workId
			);
			if (!work) throw new Error(`Work not found: ${input.workId}`);
			const mains = (await this.store.listBranches(input.workId)).filter((branch) =>
				branch.name === "main" && !branch.archivedAt
			);
			if (mains.length !== 1) {
				throw new Error(`Expected one active main Branch for Work: ${input.workId}`);
			}
			const main = mains[0];
			const copy = (await this.store.listWorkingCopies(input.workId)).find((candidate) =>
				candidate.branchId === main.id
			);
			if (!copy) throw new Error(`Working Copy not found for Branch: ${main.id}`);
			source = {
				id: "",
				workId: work.id,
				text: copy.text,
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: main.id },
				createdAt: work.createdAt,
				updatedAt: copy.updatedAt,
			};
		}
		const occurrence = {
			id: crypto.randomUUID(),
			workId: input.workId,
			parentOccurrenceId: input.parentId,
			orderKey: this.orderAfter(items, input.parentId, input.afterId ?? null),
			collapsed: false,
			revisionSelector: structuredClone(source.revisionSelector),
			contextualHeading: input.contextualHeading?.trim() || undefined,
		};
		await this.store.createOccurrence(occurrence);
		return {
			...source,
			id: occurrence.id,
			parentId: occurrence.parentOccurrenceId,
			orderKey: occurrence.orderKey,
			collapsed: occurrence.collapsed,
			revisionSelector: occurrence.revisionSelector,
			contextualHeading: occurrence.contextualHeading,
		};
	}

	async updateItemText(id: string, text: string): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateWorkingCopy(item.workId, text, new Date().toISOString());
	}

	async setCollapsed(id: string, collapsed: boolean): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: item.parentId,
			orderKey: item.orderKey,
			collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: item.contextualHeading,
		});
	}

	async setContextualHeading(id: string, contextualHeading?: string): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: item.parentId,
			orderKey: item.orderKey,
			collapsed: item.collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: contextualHeading?.trim() || undefined,
		});
	}

	async moveItem(input: MoveItemInput): Promise<void> {
		const items = await this.store.listItems();
		const item = items.find((candidate) => candidate.id === input.id);
		if (!item) throw new Error(`Outline item not found: ${input.id}`);
		const orderKey = this.orderAfter(
			items.filter((candidate) => candidate.id !== input.id),
			input.parentId,
			input.afterId ?? null,
		);
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: input.parentId,
			orderKey,
			collapsed: item.collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: item.contextualHeading,
		});
		await this.reconcileKnots();
	}

	async deleteItem(id: string): Promise<void> {
		const items = await this.store.listItems();
		const item = items.find((candidate) => candidate.id === id);
		if (!item) return;
		const children = items.filter((candidate) => candidate.parentId === id)
			.sort((a, b) => a.orderKey - b.orderKey);
		let afterId =
			items.filter((candidate) => candidate.parentId === item.parentId && candidate.id !== id)
				.sort((a, b) => a.orderKey - b.orderKey)
				.filter((candidate) => candidate.orderKey < item.orderKey).at(-1)?.id ?? null;
		for (const child of children) {
			await this.moveItem({ id: child.id, parentId: item.parentId, afterId });
			afterId = child.id;
		}
		await this.store.deleteOccurrence(id);
		await this.reconcileKnots();
	}

	async trashWork(id: string): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.trashWork(item.workId, new Date().toISOString());
	}

	async listTrash(): Promise<TrashEntry[]> {
		const works = (await this.store.listWorks(true)).filter((work) => work.deletedAt);
		const occurrences = await this.store.listOccurrences(true);
		const links = await this.store.listLinks();
		return works.map((work) => ({
			work,
			occurrenceCount: occurrences.filter((occurrence) => occurrence.workId === work.id).length,
			linkCount:
				links.filter((link) => link.from.workId === work.id || link.to.workId === work.id).length,
		}));
	}

	restoreWork(workId: string): Promise<void> {
		return this.store.restoreWork(workId);
	}

	async purgeWork(workId: string): Promise<PurgeManifest> {
		const work = (await this.store.listWorks(true)).find((candidate) => candidate.id === workId);
		if (!work?.deletedAt) {
			throw new Error(`Work must be in trash before it can be purged: ${workId}`);
		}
		return this.store.purgeWork(workId);
	}

	async createLink(input: CreateLinkInput): Promise<void> {
		if (!LINK_TYPES.includes(input.type)) throw new Error(`Unsupported link type: ${input.type}`);
		const [works, occurrences, revisions] = await Promise.all([
			this.store.listWorks(),
			this.store.listOccurrences(),
			this.store.listRevisions(),
		]);
		const workIds = new Set(works.map((work) => work.id));
		const resolveWorkId = (id: string): string => {
			const occurrence = occurrences.find((candidate) => candidate.id === id);
			const workId = workIds.has(id) ? id : occurrence?.workId;
			if (!workId || !workIds.has(workId)) throw new Error(`Active link endpoint not found: ${id}`);
			return workId;
		};
		const resolvedFromWorkId = resolveWorkId(input.fromId);
		const resolvedToWorkId = resolveWorkId(input.toId);
		const from = input.fromEndpoint ?? { scope: "work" as const, workId: resolvedFromWorkId };
		const to = input.toEndpoint ?? { scope: "work" as const, workId: resolvedToWorkId };
		const validateEndpoint = (
			endpoint: LinkEndpoint,
			resolvedWorkId: string,
			label: string,
		): void => {
			if (endpoint.scope !== "work" && endpoint.scope !== "revision") {
				throw new Error(`${label} endpoint scope is invalid`);
			}
			if (endpoint.workId !== resolvedWorkId || !workIds.has(endpoint.workId)) {
				throw new Error(`${label} endpoint does not match the resolved active Work`);
			}
			if (endpoint.scope === "revision") {
				const revision = revisions.find((candidate) => candidate.id === endpoint.revisionId);
				if (!revision || revision.workId !== endpoint.workId) {
					throw new Error(`${label} Revision endpoint does not belong to its Work`);
				}
			}
		};
		validateEndpoint(from, resolvedFromWorkId, "From");
		validateEndpoint(to, resolvedToWorkId, "To");
		if (from.workId === to.workId) throw new Error("A related link cannot target the same work");
		let fromId = from.workId;
		let toId = to.workId;
		let fromEndpoint = from;
		let toEndpoint = to;
		if (isSymmetricLinkType(input.type) && fromId.localeCompare(toId) > 0) {
			[fromId, toId] = [toId, fromId];
			[fromEndpoint, toEndpoint] = [toEndpoint, fromEndpoint];
		}
		if (isSymmetricLinkType(input.type)) {
			const duplicate = (await this.listActiveLinks()).some((link) =>
				link.type === input.type && sameEndpoint(link.from, fromEndpoint) &&
				sameEndpoint(link.to, toEndpoint)
			);
			if (duplicate) return;
		}
		await this.store.createLink({
			id: crypto.randomUUID(),
			fromId,
			toId,
			from: fromEndpoint,
			to: toEndpoint,
			type: input.type,
			status: input.status ?? "asserted",
			origin: input.origin ?? "human",
			createdAt: new Date().toISOString(),
			reason: input.reason?.trim() || undefined,
		});
	}

	resolveAdvancedLink(
		input: string,
		selections?: AdvancedLinkSelections,
	): Promise<AdvancedLinkResolution> {
		return new AdvancedLinkResolverService(this.store).resolve(input, selections);
	}

	listInternalReferenceCompletions(
		query?: string,
		limit?: number,
	): Promise<InternalReferenceCompletion[]> {
		return new InternalReferenceService(this.store).listCompletions(query, limit);
	}

	resolveInternalReferences(markdown: string): Promise<InternalReferenceResolution[]> {
		return new InternalReferenceService(this.store).resolve(markdown);
	}

	listInternalReferenceBacklinks(
		scope: RadioraReferenceScope,
		id: string,
	): Promise<InternalReferenceBacklink[]> {
		return new InternalReferenceService(this.store).listBacklinks(scope, id);
	}

	resolveLinkComparison(linkId: string): Promise<LinkComparisonProjection> {
		return new ComparisonService(this.store).resolveLink(linkId);
	}

	listWorkComparisonDocuments(workId: string): Promise<WorkComparisonDocuments> {
		return new ComparisonService(this.store).listWorkDocuments(workId);
	}

	async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		const items = await this.store.listItems();
		let fromWorkId = items.find((item) => item.id === fromId)?.workId ?? fromId;
		let toWorkId = items.find((item) => item.id === toId)?.workId ?? toId;
		if (isSymmetricLinkType(type) && fromWorkId.localeCompare(toWorkId) > 0) {
			[fromWorkId, toWorkId] = [toWorkId, fromWorkId];
		}
		return this.store.deleteLink(fromWorkId, toWorkId, type);
	}

	async suggestItems(prefix: string, limit = 8): Promise<Suggestion[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return [];
		const items = await this.store.listItems();
		const byId = new Map(items.map((item) => [item.id, item]));
		return (await this.store.suggestItems(normalized, Math.min(Math.max(limit, 1), 20)))
			.map((item) => ({ item, title: titleOf(item), ancestorIds: this.ancestors(item, byId) }));
	}

	async searchItems(request: SearchRequest | string): Promise<SearchResult[]> {
		const input = typeof request === "string" ? { query: request } : request;
		const query = normalizeSearchText(input.query);
		if (!query) return [];
		const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_SEARCH_LIMIT);
		const items = await this.store.listItems();
		const links = await this.listActiveLinks();
		const byId = new Map(items.map((item) => [item.id, item]));
		const aliases = (await this.store.listAliases()).filter((alias) => !isReservedTagAlias(alias));
		const expansions = this.expandQuery(query, aliases, items, links);
		const baseHits = await this.store.searchLexical(query, Math.max(limit * 3, 40));
		const expansionHits = (await Promise.all(expansions.map(async (expansion) => ({
			...expansion,
			hits: await this.store.searchLexical(expansion.term, Math.max(limit * 2, 30)),
		})))).flatMap(({ term, weight, label, hits }) =>
			hits.map((hit) => ({ hit, term, weight, label }))
		);
		const maxBase = Math.max(1, ...baseHits.map((hit) => hit.titleScore * 2 + hit.bodyScore));
		const maxExpanded = Math.max(
			1,
			...expansionHits.map(({ hit, weight }) => (hit.titleScore * 2 + hit.bodyScore) * weight),
		);
		const candidates = new Map<string, {
			item: OutlineItem;
			lexical: number;
			expansion: number;
			reasons: SearchResult["reasons"];
		}>();
		for (const hit of baseHits) {
			const title = normalizeSearchText(titleOf(hit.item));
			let lexical = (hit.titleScore * 2 + hit.bodyScore) / maxBase;
			if (title === query) lexical = 1;
			const reasons: SearchResult["reasons"] = [];
			if (hit.titleScore > 0) {
				reasons.push({
					kind: "title",
					label: title === query ? "タイトル完全一致" : "タイトル一致",
					score: hit.titleScore,
				});
			}
			if (hit.bodyScore > 0) {
				reasons.push({ kind: "body", label: "本文一致", score: hit.bodyScore });
			}
			candidates.set(hit.item.id, { item: hit.item, lexical, expansion: 0, reasons });
		}
		for (const { hit, weight, label } of expansionHits) {
			const candidate = candidates.get(hit.item.id) ??
				{ item: hit.item, lexical: 0, expansion: 0, reasons: [] };
			const score = ((hit.titleScore * 2 + hit.bodyScore) * weight) / maxExpanded;
			if (score > candidate.expansion) {
				candidate.expansion = score;
				candidate.reasons.push({ kind: "alias", label, score });
			}
			candidates.set(hit.item.id, candidate);
		}
		const neighbors = this.neighborMap(links);
		const context = input.contextItemId ? byId.get(input.contextItemId) : undefined;
		const contextNeighbors = context
			? neighbors.get(context.workId) ?? new Set<string>()
			: new Set<string>();
		return [...candidates.values()].map((candidate): SearchResult => {
			let graph = 0;
			if (context && context.workId !== candidate.item.workId) {
				const candidateNeighbors = neighbors.get(candidate.item.workId) ?? new Set<string>();
				if (contextNeighbors.has(candidate.item.workId)) {
					graph = 1;
					candidate.reasons.push({
						kind: "direct-link",
						label: "選択中の思索と直接接続",
						score: 1,
					});
				} else {
					const shared = [...contextNeighbors].filter((id) => candidateNeighbors.has(id));
					if (shared.length) {
						graph = Math.min(0.8, shared.length / 3);
						candidate.reasons.push({
							kind: "shared-link",
							label: `共通リンク ${shared.length}件`,
							score: graph,
						});
					}
					const contextAncestors = new Set(this.ancestors(context, byId));
					const sharedAncestors = this.ancestors(candidate.item, byId).filter((id) =>
						contextAncestors.has(id)
					);
					if (sharedAncestors.length && graph < 0.5) {
						graph = 0.5;
						candidate.reasons.push({ kind: "shared-ancestor", label: "共通の祖先", score: 0.5 });
					}
				}
			}
			return {
				item: candidate.item,
				ancestorIds: this.ancestors(candidate.item, byId),
				score: 0.55 * candidate.lexical + 0.3 * graph + 0.15 * candidate.expansion,
				reasons: candidate.reasons,
			};
		}).filter((result) => result.item.id !== input.contextItemId)
			.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
			.slice(0, limit);
	}

	listScopedTags(historyRevisionIds: string[] = []): Promise<ScopedTagSet[]> {
		return new TagService(this.store).listScopedTags(historyRevisionIds);
	}

	listTags(historyRevisionIds: string[] = []): Promise<TagSummary[]> {
		return new TagService(this.store).listTags(historyRevisionIds);
	}

	suggestTags(prefix: string, limit = 8): Promise<TagSummary[]> {
		return new TagService(this.store).suggest(prefix, limit);
	}

	searchTags(request: TagSearchRequest): Promise<ScopedTagSet[]> {
		return new TagService(this.store).search(request);
	}

	listTagAliases(): Promise<TagAlias[]> {
		return new TagService(this.store).listAliases();
	}

	renameTag(from: string, to: string): Promise<TagAlias> {
		return new TagService(this.store).rename(from, to);
	}

	mergeTags(sources: string[], target: string): Promise<TagAlias> {
		return new TagService(this.store).merge(sources, target);
	}

	async listSearchAliases(): Promise<SearchAlias[]> {
		return (await this.store.listAliases()).filter((alias) => !isReservedTagAlias(alias));
	}

	async saveSearchAlias(
		input: { id?: string; canonical: string; variants: string[] },
	): Promise<SearchAlias> {
		const canonical = normalizeSearchText(input.canonical);
		const variants = [...new Set(input.variants.map(normalizeSearchText).filter(Boolean))]
			.filter((variant) => variant !== canonical);
		if (canonical.startsWith("#") || variants.some((variant) => variant.startsWith("#"))) {
			throw new Error("タグの改名・統合にはタグ管理を使用してください。");
		}
		if (!canonical || !variants.length) {
			throw new Error("別名には基準語と1件以上の異なる表記が必要です。");
		}
		const existing = input.id
			? (await this.store.listAliases()).find((alias) => alias.id === input.id)
			: undefined;
		const now = new Date().toISOString();
		const alias: SearchAlias = {
			id: input.id ?? crypto.randomUUID(),
			canonical,
			variants,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.store.upsertAlias(alias);
		return alias;
	}

	deleteSearchAlias(id: string): Promise<void> {
		return this.store.deleteAlias(id);
	}

	async listEmergenceSuggestions(
		contextItemId: string,
		limit = 10,
	): Promise<EmergenceSuggestion[]> {
		const items = await this.store.listItems();
		const links = await this.listActiveLinks();
		const context = items.find((item) => item.id === contextItemId);
		if (!context) return [];
		const byId = new Map(items.map((item) => [item.id, item]));
		const byWorkId = new Map(items.map((item) => [item.workId, item]));
		const neighbors = this.neighborMap(links);
		const contextNeighbors = neighbors.get(context.workId) ?? new Set<string>();
		const direct = new Set(contextNeighbors);
		const suggestions = new Map<string, EmergenceSuggestion>();
		for (const candidate of byWorkId.values()) {
			if (candidate.workId === context.workId || direct.has(candidate.workId)) continue;
			const shared = [...contextNeighbors].filter((id) => neighbors.get(candidate.workId)?.has(id));
			if (shared.length >= 2) {
				this.addSuggestion(suggestions, {
					kind: "latent-relation",
					context,
					target: candidate,
					score: Math.min(1, shared.length / 3),
					proposedLinkType: "LIKE",
					title: "潜在的な関係",
					explanation: `${shared.length}件の共通リンクを介してつながっています。`,
					evidence: shared.slice(0, 3).flatMap((workId) => [
						{
							fromId: context.id,
							toId: byWorkId.get(workId)?.id ?? workId,
							relation: "LIKE" as const,
						},
						{
							fromId: byWorkId.get(workId)?.id ?? workId,
							toId: candidate.id,
							relation: "LIKE" as const,
						},
					]),
				});
			}
		}
		for (
			const result of await this.searchItems({ query: titleOf(context), contextItemId, limit: 20 })
		) {
			const target = result.item;
			if (
				direct.has(target.workId) ||
				this.rootId(context, byId) === this.rootId(target, byId) ||
				result.score < 0.35
			) continue;
			this.addSuggestion(suggestions, {
				kind: "cross-branch-resonance",
				context,
				target,
				score: result.score,
				proposedLinkType: "LIKE",
				title: "枝を越えた共鳴",
				explanation: "異なるアウトライン枝に、語彙が強く重なる思索があります。",
				evidence: [{ fromId: context.id, toId: target.id, relation: "LEXICAL" }],
			});
		}
		for (
			const first of links.filter((link) =>
				link.type === "LIKE" &&
				(link.fromId === context.workId || link.toId === context.workId)
			)
		) {
			const middle = first.fromId === context.workId ? first.toId : first.fromId;
			for (
				const second of links.filter((link) =>
					(link.type === "VS" || link.type === "FIX") &&
					(link.fromId === middle || link.toId === middle)
				)
			) {
				const targetId = second.fromId === middle ? second.toId : second.fromId;
				const target = byWorkId.get(targetId);
				if (!target || target.workId === context.workId) continue;
				this.addSuggestion(suggestions, {
					kind: "productive-tension",
					context,
					target,
					score: 0.65,
					title: "対立・修正の観点",
					explanation: `類似する思索の先に${second.type}関係があります。`,
					evidence: [
						{
							fromId: context.id,
							toId: byWorkId.get(middle)?.id ?? middle,
							relation: "LIKE",
						},
						{
							fromId: byWorkId.get(middle)?.id ?? middle,
							toId: target.id,
							relation: second.type,
						},
					],
				});
			}
		}
		const visible: EmergenceSuggestion[] = [];
		for (const suggestion of suggestions.values()) {
			const feedback = await this.store.getEmergenceFeedback(suggestion.id);
			if (feedback === "dismiss" || feedback === "accept") continue;
			if (feedback === "pin") suggestion.status = "pinned";
			this.suggestionCache.set(suggestion.id, suggestion);
			visible.push(suggestion);
		}
		return visible.sort((a, b) =>
			Number(b.status === "pinned") - Number(a.status === "pinned") || b.score - a.score
		).slice(0, Math.min(Math.max(limit, 1), 30));
	}

	async resolveEmergenceSuggestion(id: string, action: EmergenceAction): Promise<void> {
		const suggestion = this.suggestionCache.get(id);
		if (!suggestion) throw new Error("提案が古くなりました。再読み込みしてください。");
		if (action === "accept" && suggestion.proposedLinkType) {
			const [context, target] = await Promise.all([
				this.requireItem(suggestion.contextItemId),
				this.requireItem(suggestion.targetItemId),
			]);
			const links = await this.listActiveLinks();
			const exists = links.some((link) =>
				link.type === suggestion.proposedLinkType &&
				((link.fromId === context.workId && link.toId === target.workId) ||
					(link.fromId === target.workId && link.toId === context.workId))
			);
			if (!exists) {
				await this.createLink({
					fromId: suggestion.contextItemId,
					toId: suggestion.targetItemId,
					type: suggestion.proposedLinkType,
				});
			}
		}
		await this.store.setEmergenceFeedback(id, action);
	}

	async runRuleQuery(source: string, limit = 500): Promise<RuleQueryResult> {
		const [items, links] = await Promise.all([
			this.store.listItems(),
			this.listActiveLinks(),
		]);
		const representativeByWork = new Map<string, string>();
		for (const item of items) {
			if (!representativeByWork.has(item.workId)) {
				representativeByWork.set(item.workId, item.id);
			}
		}
		const occurrenceLinks = links.flatMap((link) => {
			const fromId = representativeByWork.get(link.from.workId);
			const toId = representativeByWork.get(link.to.workId);
			return fromId && toId ? [{ ...link, fromId, toId }] : [];
		});
		return runRuleQuery(source, items, occurrenceLinks, limit);
	}

	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return this.store.listSavedRuleQueries();
	}

	async saveRuleQuery(
		input: { id?: string; name: string; source: string },
	): Promise<SavedRuleQuery> {
		const now = new Date().toISOString();
		const existing = input.id
			? (await this.store.listSavedRuleQueries()).find((query) => query.id === input.id)
			: undefined;
		await this.runRuleQuery(input.source, 1);
		const saved: SavedRuleQuery = {
			id: input.id ?? crypto.randomUUID(),
			name: input.name.trim() || "名称未設定",
			source: input.source,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.store.upsertSavedRuleQuery(saved);
		return saved;
	}

	deleteRuleQuery(id: string): Promise<void> {
		return this.store.deleteSavedRuleQuery(id);
	}

	async buildQueryProjectionNodes(
		queryId: string,
		limit = 500,
	): Promise<{ nodes: TransientProjectionNode[]; result: RuleQueryResult }> {
		const query = (await this.store.listSavedRuleQueries()).find((q) => q.id === queryId);
		if (!query) throw new Error("Saved Rule Query not found");
		const [result, items, links] = await Promise.all([
			this.runRuleQuery(query.source, limit),
			this.store.listItems(),
			this.listActiveLinks(),
		]);
		const itemsById = new Map(items.map((i) => [i.id, i]));
		const seenIds = new Set<string>();
		const pseudoResults: SearchResult[] = [];
		for (const row of result.rows) {
			for (const cell of row) {
				if (seenIds.has(cell)) continue;
				const item = itemsById.get(cell);
				if (!item) continue;
				seenIds.add(cell);
				pseudoResults.push({
					item,
					ancestorIds: ancestorsOf(item, itemsById),
					score: 1,
					reasons: [{ kind: "title", label: "Query一致", score: 1 }],
				});
			}
		}
		return {
			nodes: buildSparseOutline(pseudoResults, items, links, "query"),
			result,
		};
	}

	private expandQuery(
		query: string,
		aliases: SearchAlias[],
		items: OutlineItem[],
		links: Awaited<ReturnType<GraphStore["listLinks"]>>,
	): { term: string; weight: number; label: string }[] {
		const expansions = new Map<string, { term: string; weight: number; label: string }>();
		for (const alias of aliases) {
			const terms = [
				normalizeSearchText(alias.canonical),
				...alias.variants.map(normalizeSearchText),
			];
			if (!terms.includes(query)) continue;
			for (const term of terms.filter((term) => term !== query)) {
				expansions.set(term, { term, weight: 0.9, label: `別名: ${term}` });
			}
		}
		const seeds = items.filter((item) => normalizeSearchText(titleOf(item)) === query);
		for (const seed of seeds) {
			for (
				const link of links.filter((link) =>
					link.type === "LIKE" &&
					(link.fromId === seed.workId || link.toId === seed.workId)
				)
			) {
				const target = items.find((item) =>
					item.workId === (link.fromId === seed.workId ? link.toId : link.fromId)
				);
				const term = target ? normalizeSearchText(titleOf(target)) : "";
				if (term && term !== query && !expansions.has(term) && expansions.size < 5) {
					expansions.set(term, { term, weight: 0.5, label: `LIKEリンク: ${titleOf(target!)}` });
				}
			}
		}
		return [...expansions.values()];
	}

	private neighborMap(
		links: Awaited<ReturnType<GraphStore["listLinks"]>>,
	): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		for (const link of links) {
			const from = result.get(link.fromId) ?? new Set<string>();
			const to = result.get(link.toId) ?? new Set<string>();
			from.add(link.toId);
			to.add(link.fromId);
			result.set(link.fromId, from);
			result.set(link.toId, to);
		}
		return result;
	}

	private async listActiveLinks(): Promise<Awaited<ReturnType<GraphStore["listLinks"]>>> {
		return (await this.store.listLinks()).filter((link) => link.status !== "retracted");
	}

	private markRecursivePlacements(items: OutlineItem[]): OutlineItem[] {
		const byId = new Map(items.map((item) => [item.id, item]));
		return items.map((item) => {
			const visited = new Set<string>();
			let parentId = item.parentId;
			while (parentId) {
				if (visited.has(parentId)) break;
				visited.add(parentId);
				const parent = byId.get(parentId);
				if (!parent) break;
				if (parent.workId === item.workId) return { ...item, referenceStub: true };
				parentId = parent.parentId;
			}
			return item;
		});
	}

	private rootId(item: OutlineItem, byId: Map<string, OutlineItem>): string {
		const visited = new Set([item.id]);
		let current = item;
		while (current.parentId && !visited.has(current.parentId)) {
			visited.add(current.parentId);
			const parent = byId.get(current.parentId);
			if (!parent) break;
			current = parent;
		}
		return current.id;
	}

	private addSuggestion(
		target: Map<string, EmergenceSuggestion>,
		input: Omit<EmergenceSuggestion, "id" | "contextItemId" | "targetItemId"> & {
			context: OutlineItem;
			target: OutlineItem;
		},
	): void {
		const id = this.fingerprint(`${input.kind}:${input.context.id}:${input.target.id}`);
		target.set(id, {
			id,
			kind: input.kind,
			contextItemId: input.context.id,
			targetItemId: input.target.id,
			proposedLinkType: input.proposedLinkType,
			title: input.title,
			explanation: input.explanation,
			evidence: input.evidence,
			score: input.score,
		});
	}

	private fingerprint(value: string): string {
		let hash = 2166136261;
		for (const char of value) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 16777619);
		}
		return `s-${(hash >>> 0).toString(16)}`;
	}

	private async requireItem(id: string): Promise<OutlineItem> {
		const item = (await this.store.listItems()).find((candidate) => candidate.id === id);
		if (!item) throw new Error(`Outline item not found: ${id}`);
		return item;
	}

	private orderAfter(
		items: OutlineItem[],
		parentId: string | null,
		afterId: string | null,
	): number {
		const siblings = items.filter((item) => item.parentId === parentId)
			.sort((a, b) => a.orderKey - b.orderKey);
		if (!siblings.length) return ORDER_STEP;
		if (!afterId) return siblings[0].orderKey - ORDER_STEP;
		const index = siblings.findIndex((item) => item.id === afterId);
		if (index < 0 || index === siblings.length - 1) return siblings.at(-1)!.orderKey + ORDER_STEP;
		return (siblings[index].orderKey + siblings[index + 1].orderKey) / 2;
	}

	private ancestors(item: OutlineItem, byId: Map<string, OutlineItem>): string[] {
		const result: string[] = [];
		const visited = new Set([item.id]);
		let parentId = item.parentId;
		while (parentId && !visited.has(parentId)) {
			visited.add(parentId);
			result.unshift(parentId);
			parentId = byId.get(parentId)?.parentId ?? null;
		}
		return result;
	}

	private detectKnots(items: OutlineItem[]): Knot[] {
		const byId = new Map(items.map((item) => [item.id, item]));
		const signatures = new Set<string>();
		const knots: Knot[] = [];
		for (const start of items) {
			const path: string[] = [];
			const position = new Map<string, number>();
			let current: OutlineItem | undefined = start;
			while (current) {
				const existing = position.get(current.id);
				if (existing !== undefined) {
					const cycleIds = path.slice(existing).sort();
					const signature = cycleIds.join(":");
					if (!signatures.has(signature)) {
						signatures.add(signature);
						knots.push({
							id: this.fingerprint(`knot:${signature}`),
							cycleIds,
							createdAt: new Date().toISOString(),
						});
					}
					break;
				}
				position.set(current.id, path.length);
				path.push(current.id);
				if (current.parentId && !byId.has(current.parentId)) {
					const signature = `orphan:${current.id}`;
					if (!signatures.has(signature)) {
						signatures.add(signature);
						knots.push({
							id: this.fingerprint(`knot:${signature}`),
							cycleIds: [current.id],
							createdAt: new Date().toISOString(),
						});
					}
					break;
				}
				current = current.parentId ? byId.get(current.parentId) : undefined;
			}
		}
		return knots;
	}

	private async reconcileKnots(): Promise<void> {
		await this.store.replaceKnots(this.detectKnots(await this.store.listItems()));
	}
}

function isReservedTagAlias(alias: SearchAlias): boolean {
	return alias.canonical.startsWith("#") &&
		alias.variants.every((variant) => variant.startsWith("#"));
}

function ancestorsOf(
	item: OutlineItem,
	byId: Map<string, OutlineItem>,
): string[] {
	const result: string[] = [];
	const visited = new Set([item.id]);
	let parentId = item.parentId;
	while (parentId && !visited.has(parentId)) {
		visited.add(parentId);
		result.unshift(parentId);
		parentId = byId.get(parentId)?.parentId ?? null;
	}
	return result;
}
