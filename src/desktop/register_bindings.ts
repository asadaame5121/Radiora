import type { RadioraBindings, StartupStatus } from "../shared/bindings.ts";
import type { OutlineService } from "../services/outline_service.ts";
import type {
	RewriteAsNewBranchResult,
	RewriteConfirmation,
} from "../services/revision_service.ts";

export interface BindingContext {
	getService(): OutlineService | null;
	getStartupStatus(): StartupStatus;
	retryStartup(): Promise<StartupStatus>;
	rewriteAsNewBranch(
		sourceBranchId: string,
		newBranchName: string,
		confirmation: RewriteConfirmation,
	): Promise<RewriteAsNewBranchResult>;
}

export function createBindingHandlers(context: BindingContext): RadioraBindings {
	const service = (): OutlineService => {
		const current = context.getService();
		if (current) return current;
		const status = context.getStartupStatus();
		throw new Error(status.phase === "failed" ? status.message : "Radiora is still starting.");
	};
	return {
		getStartupStatus: async () => context.getStartupStatus(),
		retryStartup: () => context.retryStartup(),
		listOutline: () => service().listOutline(),
		projectDates: (range) => service().projectDates(range),
		projectManuscript: (rootOccurrenceId) => service().projectManuscript(rootOccurrenceId),
		exportOpml: () => service().exportOpml(),
		importOpml: (source) => service().importOpml(source),
		listBookmarks: () => service().listBookmarks(),
		createBookmark: (occurrenceId) => service().createBookmark(occurrenceId),
		deleteBookmark: (id) => service().deleteBookmark(id),
		resolveBookmark: (id) => service().resolveBookmark(id),
		saveResumePosition: (occurrenceId, caretOffset) =>
			service().saveResumePosition(occurrenceId, caretOffset),
		resolveResumePosition: () => service().resolveResumePosition(),
		clearResumePosition: () => service().clearResumePosition(),
		listRevisions: (workId) => service().listRevisions(workId),
		listRecoverySnapshots: (workId, branchId) => service().listRecoverySnapshots(workId, branchId),
		previewRecoverySnapshot: (snapshotId, workId, branchId) =>
			service().previewRecoverySnapshot(snapshotId, workId, branchId),
		restoreRecoverySnapshot: (snapshotId, workId, branchId, confirmation) =>
			service().restoreRecoverySnapshot(snapshotId, workId, branchId, confirmation),
		promoteRecoverySnapshot: (snapshotId, workId, branchId, confirmation, message) =>
			service().promoteRecoverySnapshot(
				snapshotId,
				workId,
				branchId,
				confirmation,
				message,
			),
		listGlobalLineage: () => service().listGlobalLineage(),
		listWorkLineage: (workId) => service().listWorkLineage(workId),
		rewriteAsNewBranch: (sourceBranchId, newBranchName, confirmation) => {
			service();
			return context.rewriteAsNewBranch(sourceBranchId, newBranchName, confirmation);
		},
		createItem: (input) => service().createItem(input),
		quickCapture: (text) => service().quickCapture(text),
		listUnplacedWorks: () => service().listUnplacedWorks(),
		updateUnplacedWorkText: (workId, text) => service().updateUnplacedWorkText(workId, text),
		placeUnplacedWork: (input) => service().placeUnplacedWork(input),
		createOccurrence: (input) => service().createOccurrence(input),
		updateItemText: (id, text) => service().updateItemText(id, text),
		setContextualHeading: (id, contextualHeading) =>
			service().setContextualHeading(id, contextualHeading),
		moveItem: (input) => service().moveItem(input),
		deleteItem: (id) => service().deleteItem(id),
		trashWork: (id) => service().trashWork(id),
		listTrash: () => service().listTrash(),
		restoreWork: (workId) => service().restoreWork(workId),
		purgeWork: (workId) => service().purgeWork(workId),
		setCollapsed: (id, collapsed) => service().setCollapsed(id, collapsed),
		createLink: (input) => service().createLink(input),
		resolveAdvancedLink: (input, selections) => service().resolveAdvancedLink(input, selections),
		listInternalReferenceCompletions: (query, limit) =>
			service().listInternalReferenceCompletions(query, limit),
		resolveInternalReferences: (markdown) => service().resolveInternalReferences(markdown),
		listInternalReferenceBacklinks: (scope, id) =>
			service().listInternalReferenceBacklinks(scope, id),
		listStubs: () => service().listStubs(),
		createStub: (createdVia, context) => service().createStub(createdVia, context),
		resolveStub: (workId) => service().resolveStub(workId),
		listDuplicateCandidates: (limit) => service().listDuplicateCandidates(limit),
		previewWorkMerge: (sourceWorkId, survivorWorkId) =>
			service().previewWorkMerge(sourceWorkId, survivorWorkId),
		mergeWorks: (preview) => service().mergeWorks(preview),
		resolveLinkComparison: (linkId) => service().resolveLinkComparison(linkId),
		listWorkComparisonDocuments: (workId) => service().listWorkComparisonDocuments(workId),
		deleteLink: (fromId, toId, type) => service().deleteLink(fromId, toId, type),
		suggestItems: (prefix, limit) => service().suggestItems(prefix, limit),
		searchItems: (request) => service().searchItems(request),
		listScopedTags: (historyRevisionIds) => service().listScopedTags(historyRevisionIds),
		listTags: (historyRevisionIds) => service().listTags(historyRevisionIds),
		suggestTags: (prefix, limit) => service().suggestTags(prefix, limit),
		searchTags: (request) => service().searchTags(request),
		listTagAliases: () => service().listTagAliases(),
		renameTag: (from, to) => service().renameTag(from, to),
		mergeTags: (sources, target) => service().mergeTags(sources, target),
		listSearchAliases: () => service().listSearchAliases(),
		saveSearchAlias: (input) => service().saveSearchAlias(input),
		deleteSearchAlias: (id) => service().deleteSearchAlias(id),
		listEmergenceSuggestions: (contextItemId, limit) =>
			service().listEmergenceSuggestions(contextItemId, limit),
		resolveEmergenceSuggestion: (id, action, reason) =>
			service().resolveEmergenceSuggestion(id, action, reason),
		runRuleQuery: (source, limit) => service().runRuleQuery(source, limit),
		listSavedRuleQueries: () => service().listSavedRuleQueries(),
		saveRuleQuery: (input) => service().saveRuleQuery(input),
		deleteRuleQuery: (id) => service().deleteRuleQuery(id),
		buildQueryProjectionNodes: (queryId, limit) =>
			service().buildQueryProjectionNodes(queryId, limit),
	};
}

export function registerBindings(win: Deno.BrowserWindow, context: BindingContext): void {
	const handlers = createBindingHandlers(context);
	for (const [name, handler] of Object.entries(handlers)) {
		win.bind(name, handler);
	}
}
