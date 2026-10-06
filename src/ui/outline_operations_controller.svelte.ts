import type { OutlineItem } from "../domain/models.ts";

export interface OutlineOperationsApi {
	moveItem(input: {
		id: string;
		parentId: string | null;
		afterId: string | null;
	}): Promise<void>;
	setCollapsed(id: string, collapsed: boolean): Promise<void>;
	updateItemText(id: string, text: string): Promise<void>;
	createItem(input: {
		text: string;
		parentId: string | null;
		afterId: string | null;
	}): Promise<OutlineItem>;
	deleteItem(id: string): Promise<void>;
	createOccurrence?(input: {
		workId: string;
		parentId: string | null;
		afterId: string | null;
	}): Promise<{ id: string }>;
	setContextualHeading?(id: string, value: string): Promise<void>;
}

export interface OutlineOperationsControllerOptions {
	api: OutlineOperationsApi;
	getItems: () => readonly OutlineItem[];
	getItemById: (id: string) => OutlineItem | undefined;
	reload: (focusId?: string, current?: () => boolean) => Promise<boolean | undefined>;
	flushAutosave: (workId: string) => Promise<void>;
	reportError: (cause: unknown) => void;
	captureRequest: () => () => boolean;
	pendingEmpty: { track(id: string): void; forget(id: string): void };
	clearTemporaryExpansion: (id: string) => void;
	selection: { current(): string | null; clear(): void };
}

type EditingKeyEvent = Pick<
	KeyboardEvent,
	| "key"
	| "keyCode"
	| "isComposing"
	| "ctrlKey"
	| "metaKey"
	| "shiftKey"
	| "altKey"
	| "preventDefault"
>;
type ReadRowSelection = () => { start: number; end: number };
const IME_PROCESS_KEY_CODE = 229;

/** Editing order lives here; snapshot, drafts, pending records and selection retain their owners. */
export class OutlineOperationsController {
	constructor(private readonly options: OutlineOperationsControllerOptions) {}

	createRoot = async (): Promise<void> => {
		const current = this.options.captureRequest();
		const roots = this.options.getItems().filter((item) => item.parentId === null);
		try {
			const item = await this.options.api.createItem({
				text: "",
				parentId: null,
				afterId: roots.sort((a, b) => a.orderKey - b.orderKey).at(-1)?.id ?? null,
			});
			this.options.pendingEmpty.track(item.id);
			await this.options.reload(item.id, current);
		} catch (cause) {
			if (current()) this.options.reportError(cause);
		}
	};

	createChildOccurrence = async (
		selectedItem: OutlineItem | undefined,
	): Promise<void> => {
		if (!selectedItem || !this.options.api.createOccurrence) return;
		try {
			await this.options.flushAutosave(selectedItem.workId);
		} catch (cause) {
			this.options.reportError(cause);
			return;
		}
		const created = await this.options.api.createOccurrence({
			workId: selectedItem.workId,
			parentId: selectedItem.parentId,
			afterId: selectedItem.id,
		});
		await this.options.reload(created.id);
	};

	updateHeading = async (id: string, value: string): Promise<void> => {
		if (!this.options.api.setContextualHeading) return;
		await this.options.api.setContextualHeading(id, value);
		await this.options.reload(id);
	};

	remove = async (id: string): Promise<void> => {
		const current = this.options.captureRequest();
		const item = this.options.getItemById(id);
		if (item) {
			try {
				await this.options.flushAutosave(item.workId);
			} catch (cause) {
				if (current()) this.options.reportError(cause);
				return;
			}
		}
		await this.options.api.deleteItem(id);
		this.options.pendingEmpty.forget(id);
		// A completed deletion corrects only its still-selected target, even after receipt expiry.
		if (this.options.selection.current() === id) this.options.selection.clear();
		await this.options.reload();
	};

	siblingsOf = (item: OutlineItem): OutlineItem[] => {
		return this.options
			.getItems()
			.filter((candidate) => candidate.parentId === item.parentId)
			.sort((a, b) => a.orderKey - b.orderKey);
	};

	indent = async (item: OutlineItem): Promise<void> => {
		const current = this.options.captureRequest();
		const siblings = this.siblingsOf(item);
		const index = siblings.findIndex((candidate) => candidate.id === item.id);
		if (index <= 0) return;
		const parent = siblings[index - 1];
		const children = this.options
			.getItems()
			.filter((candidate) => candidate.parentId === parent.id)
			.sort((a, b) => a.orderKey - b.orderKey);
		await this.options.api.moveItem({
			id: item.id,
			parentId: parent.id,
			afterId: children.at(-1)?.id ?? null,
		});
		await this.options.reload(item.id, current);
	};

	outdent = async (item: OutlineItem): Promise<void> => {
		const current = this.options.captureRequest();
		if (!item.parentId) return;
		const parent = this.options.getItemById(item.parentId);
		if (!parent) return;
		await this.options.api.moveItem({
			id: item.id,
			parentId: parent.parentId,
			afterId: parent.id,
		});
		await this.options.reload(item.id, current);
	};

	moveSibling = async (item: OutlineItem, direction: -1 | 1): Promise<void> => {
		const current = this.options.captureRequest();
		const siblings = this.siblingsOf(item);
		const index = siblings.findIndex((candidate) => candidate.id === item.id);
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= siblings.length) return;
		const afterId = direction < 0
			? (siblings[targetIndex - 1]?.id ?? null)
			: siblings[targetIndex].id;
		await this.options.api.moveItem({
			id: item.id,
			parentId: item.parentId,
			afterId,
		});
		await this.options.reload(item.id, current);
	};

	toggle = async (item: OutlineItem): Promise<void> => {
		this.options.clearTemporaryExpansion(item.id);
		await this.options.api.setCollapsed(item.id, !item.collapsed);
		await this.options.reload();
	};

	splitRow = async (
		item: OutlineItem,
		readSelection: ReadRowSelection,
	): Promise<OutlineItem | null> => {
		const current = this.options.captureRequest();
		try {
			await this.options.flushAutosave(item.workId);
		} catch (cause) {
			if (current()) this.options.reportError(cause);
			return null;
		}
		const selection = readSelection();
		const left = item.text.slice(0, selection.start);
		const right = item.text.slice(selection.end);
		await this.options.api.updateItemText(item.id, left);
		const created = await this.options.api.createItem({
			text: right,
			parentId: item.parentId,
			afterId: item.id,
		});
		if (!right.trim()) this.options.pendingEmpty.track(created.id);
		await this.options.reload(created.id, current);
		return created;
	};

	canDeleteEmptyRow = (item: OutlineItem): boolean => {
		if (item.text.trim()) return false;
		const siblings = this.siblingsOf(item).filter((candidate) =>
			candidate.orderKey < item.orderKey
		);
		return siblings.length > 0;
	};

	deleteEmptyRow = async (item: OutlineItem): Promise<boolean> => {
		const current = this.options.captureRequest();
		if (!this.canDeleteEmptyRow(item)) return false;
		const siblings = this.siblingsOf(item).filter((candidate) =>
			candidate.orderKey < item.orderKey
		);
		const previous = siblings.at(-1);
		if (!previous) return false;
		try {
			await this.options.flushAutosave(item.workId);
		} catch (cause) {
			if (current()) this.options.reportError(cause);
			return false;
		}
		await this.options.api.deleteItem(item.id);
		this.options.pendingEmpty.forget(item.id);
		await this.options.reload(previous.id, current);
		return true;
	};

	/** The View handles completion first; this module interprets structural editing keys. */
	handleKeydown = async (
		event: EditingKeyEvent,
		item: OutlineItem,
		readSelection: ReadRowSelection,
	): Promise<void> => {
		if (
			event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE || event.ctrlKey || event.metaKey
		) return;
		const current = this.options.captureRequest();
		try {
			await this.dispatchEditingKey(event, item, readSelection);
		} catch (cause) {
			if (current()) this.options.reportError(cause);
		}
	};

	private async dispatchEditingKey(
		event: EditingKeyEvent,
		item: OutlineItem,
		readSelection: ReadRowSelection,
	): Promise<void> {
		switch (event.key) {
			case "Enter":
				if (event.shiftKey || event.altKey) return;
				event.preventDefault();
				if (item.text.trim()) await this.splitRow(item, readSelection);
				break;
			case "Tab":
				if (event.altKey) return;
				event.preventDefault();
				if (event.shiftKey) await this.outdent(item);
				else await this.indent(item);
				break;
			case "Backspace":
				if (event.altKey || !this.canDeleteEmptyRow(item)) return;
				event.preventDefault();
				await this.deleteEmptyRow(item);
				break;
			case "ArrowUp":
			case "ArrowDown":
				if (!event.altKey) return;
				event.preventDefault();
				await this.moveSibling(item, event.key === "ArrowUp" ? -1 : 1);
				break;
		}
	}
}
