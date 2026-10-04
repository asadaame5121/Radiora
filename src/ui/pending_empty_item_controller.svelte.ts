import type { OutlineSnapshot } from "../domain/models.ts";
import { loadPendingEmptyItemIds, savePendingEmptyItemIds } from "./pending_empty_item_storage.ts";

export function createPendingEmptyItemController(ports: {
	getSnapshot(): OutlineSnapshot;
	flushAutosave(workId: string): Promise<void>;
	deleteItem(id: string): Promise<void>;
	reload(current?: () => boolean): Promise<unknown>;
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

	function isEmptyLeaf(id: string): boolean {
		const items = ports.getSnapshot().items;
		const item = items.find((candidate) => candidate.id === id);
		return Boolean(
			item && !item.text.trim() && !items.some((candidate) => candidate.parentId === id),
		);
	}

	async function discard(id: string, requestCurrent?: () => boolean): Promise<boolean> {
		const canPublish = requestCurrent ?? (() => true);
		if (!canPublish()) return false;
		if (!pendingIds.has(id)) return true;
		const item = ports.getSnapshot().items.find((candidate) => candidate.id === id);
		if (!item || item.text.trim()) {
			forget(id);
			return true;
		}
		try {
			await ports.flushAutosave(item.workId);
			return await discardAfterFlush(id, requestCurrent);
		} catch (cause) {
			if (canPublish()) ports.reportError(cause);
			return false;
		}
	}

	async function discardAfterFlush(id: string, requestCurrent?: () => boolean): Promise<boolean> {
		const canPublish = requestCurrent ?? (() => true);
		if (!canPublish()) return false;
		if (!pendingIds.has(id)) return true;
		if (!isEmptyLeaf(id)) {
			forget(id);
			return true;
		}
		await ports.deleteItem(id);
		forget(id);
		if (!canPublish()) return false;
		return await ports.reload(requestCurrent) !== false;
	}

	async function discardRestored(current = () => true): Promise<boolean> {
		for (const id of [...pendingIds]) {
			if (!await discard(id, current)) return false;
		}
		return current();
	}

	return { track, forget, noteTextChange, discard, discardRestored };
}
