import type {
	CreateItemInput,
	CreateLinkInput,
	LinkType,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	SearchResult,
} from "../domain/models.ts";

export interface RadioraBindings {
	getStartupStatus(): Promise<StartupStatus>;
	retryStartup(): Promise<StartupStatus>;
	listOutline(): Promise<OutlineSnapshot>;
	createItem(input: CreateItemInput): Promise<OutlineItem>;
	updateItemText(id: string, text: string): Promise<void>;
	moveItem(input: MoveItemInput): Promise<void>;
	deleteItem(id: string): Promise<void>;
	setCollapsed(id: string, collapsed: boolean): Promise<void>;
	createLink(input: CreateLinkInput): Promise<void>;
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	searchItems(query: string): Promise<SearchResult[]>;
}

export type StartupPhase = "starting" | "ready" | "failed";

export interface StartupStatus {
	phase: StartupPhase;
	message: string;
	detail?: string;
	logPath?: string;
}

declare global {
	const bindings: RadioraBindings;
}
