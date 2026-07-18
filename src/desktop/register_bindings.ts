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
		updateItemText: (id, text) => service().updateItemText(id, text),
		moveItem: (input) => service().moveItem(input),
		deleteItem: (id) => service().deleteItem(id),
		setCollapsed: (id, collapsed) => service().setCollapsed(id, collapsed),
		createLink: (input) => service().createLink(input),
		deleteLink: (fromId, toId, type) => service().deleteLink(fromId, toId, type),
		searchItems: (query) => service().searchItems(query),
	};
}

export function registerBindings(win: Deno.BrowserWindow, context: BindingContext): void {
	const handlers = createBindingHandlers(context);
	for (const [name, handler] of Object.entries(handlers)) {
		win.bind(name, handler);
	}
}
