import type { RadioraBindings, StartupStatus } from "../shared/bindings.ts";
import type { OutlineService } from "../services/outline_service.ts";

export interface BindingContext {
	getService(): OutlineService | null;
	getStartupStatus(): StartupStatus;
	retryStartup(): Promise<StartupStatus>;
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
		createItem: (input) => service().createItem(input),
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
		deleteLink: (fromId, toId, type) => service().deleteLink(fromId, toId, type),
		suggestItems: (prefix, limit) => service().suggestItems(prefix, limit),
		searchItems: (request) => service().searchItems(request),
		listSearchAliases: () => service().listSearchAliases(),
		saveSearchAlias: (input) => service().saveSearchAlias(input),
		deleteSearchAlias: (id) => service().deleteSearchAlias(id),
		listEmergenceSuggestions: (contextItemId, limit) =>
			service().listEmergenceSuggestions(contextItemId, limit),
		resolveEmergenceSuggestion: (id, action) => service().resolveEmergenceSuggestion(id, action),
		runRuleQuery: (source, limit) => service().runRuleQuery(source, limit),
		listSavedRuleQueries: () => service().listSavedRuleQueries(),
		saveRuleQuery: (input) => service().saveRuleQuery(input),
		deleteRuleQuery: (id) => service().deleteRuleQuery(id),
	};
}

export function registerBindings(win: Deno.BrowserWindow, context: BindingContext): void {
	const handlers = createBindingHandlers(context);
	for (const [name, handler] of Object.entries(handlers)) {
		win.bind(name, handler);
	}
}
