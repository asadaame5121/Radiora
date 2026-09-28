import type { OutlineSnapshot } from "../domain/models.ts";
import { loadPendingEmptyItemIds, savePendingEmptyItemIds } from "./pending_empty_item_storage.ts";

export function createPendingEmptyItemController(ports: {
	getSnapshot(): OutlineSnapshot;
	flushAutosave(workId: string): Promise<void>;
	deleteItem(id: string): Promise<void>;
	reload(): Promise<unknown>;
	reportError(cause: unknown): void;
}) {
	const pendingIds = new Set(loadPendingEmptyItemIds());
	function persist(): void {
		try {
			savePendingEmptyItemIds(pendingIds);
		} catch (cause) {
			ports.reportError(cause);
		}
	}

	function forget(id: string): void {
		if (!pendingIds.delete(id)) return;
		persist();
	}

	function track(id: string): void {
		pendingIds.add(id);
		persist();
	}

	function noteTextChange(id: string, text: string): void {
		if (text.trim()) forget(id);
	}

	async function discard(id: string): Promise<void> {
		if (!pendingIds.has(id)) return;
		const item = ports.getSnapshot().items.find((candidate) => candidate.id === id);
		if (!item || item.text.trim()) {
			forget(id);
			return;
		}
		try {
			await ports.flushAutosave(item.workId);
			if (!pendingIds.has(id)) return;
			const items = ports.getSnapshot().items;
			const current = items.find((candidate) => candidate.id === id);
			if (!current || current.text.trim() || items.some((candidate) => candidate.parentId === id)) {
				forget(id);
				return;
			}
			await ports.deleteItem(id);
			forget(id);
			await ports.reload();
		} catch (cause) {
			ports.reportError(cause);
		}
	}

	async function discardRestored(): Promise<void> {
		for (const id of [...pendingIds]) await discard(id);
	}

	return { track, forget, noteTextChange, discard, discardRestored };
}
