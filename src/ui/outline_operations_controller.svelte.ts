import type { OutlineItem } from "../domain/models.ts";

export interface OutlineOperationsApi {
	moveItem(input: {
		id: string;
		parentId: string | null;
		afterId: string | null;
	}): Promise<void>;
	setCollapsed(id: string, collapsed: boolean): Promise<void>;
	updateItemText(id: string, text: string): Promise<OutlineItem>;
	createItem(input: {
		text: string;
		parentId: string | null;
		afterId: string | null;
	}): Promise<OutlineItem>;
	deleteItem(id: string): Promise<void>;
}

export interface OutlineOperationsControllerOptions {
	api: OutlineOperationsApi;
	getItems: () => readonly OutlineItem[];
	getItemById: (id: string) => OutlineItem | undefined;
	reload: (focusId?: string) => Promise<boolean | undefined>;
	flushAutosave: (workId: string) => Promise<void>;
	reportError: (cause: unknown) => void;
}

export class OutlineOperationsController {
	constructor(private readonly options: OutlineOperationsControllerOptions) {}

	siblingsOf = (item: OutlineItem): OutlineItem[] => {
		return this.options
			.getItems()
			.filter((candidate) => candidate.parentId === item.parentId)
			.sort((a, b) => a.orderKey - b.orderKey);
	};

	indent = async (item: OutlineItem): Promise<void> => {
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
		await this.options.reload(item.id);
	};

	outdent = async (item: OutlineItem): Promise<void> => {
		if (!item.parentId) return;
		const parent = this.options.getItemById(item.parentId);
		if (!parent) return;
		await this.options.api.moveItem({
			id: item.id,
			parentId: parent.parentId,
			afterId: parent.id,
		});
		await this.options.reload(item.id);
	};

	moveSibling = async (item: OutlineItem, direction: -1 | 1): Promise<void> => {
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
		await this.options.reload(item.id);
	};

	toggle = async (item: OutlineItem): Promise<void> => {
		await this.options.api.setCollapsed(item.id, !item.collapsed);
		await this.options.reload();
	};
}
