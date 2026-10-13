import type { OutlineSnapshot } from "../domain/models.ts";
import { loadPendingEmptyItemIds, savePendingEmptyItemIds } from "./pending_empty_item_storage.ts";

type DiscardEmptyItemsResult = { deletedIds: string[]; handledIds: string[] };

interface PendingEmptyItemPorts {
	getSnapshot(): OutlineSnapshot;
	flushAutosave(workId: string): Promise<void>;
	deleteItem(id: string): Promise<void>;
	discardEmptyItems(ids: readonly string[]): Promise<DiscardEmptyItemsResult>;
	isEditing?(id: string): boolean;
	reload(current?: () => boolean): Promise<unknown>;
	reportError(cause: unknown): void;
}

function isEmptyLeaf(ports: PendingEmptyItemPorts, id: string): boolean {
	const items = ports.getSnapshot().items;
	const item = items.find((candidate) => candidate.id === id);
	return Boolean(
		item && !item.text.trim() && !items.some((candidate) => candidate.parentId === id),
	);
}

async function discardAfterFlush(
	ports: PendingEmptyItemPorts,
	pendingIds: Set<string>,
	forget: (id: string) => void,
	id: string,
	current: () => boolean,
): Promise<boolean> {
	if (!current()) return false;
	if (!pendingIds.has(id)) return true;
	if (!isEmptyLeaf(ports, id)) {
		forget(id);
		return true;
	}
	await ports.deleteItem(id);
	forget(id);
	if (!current()) return false;
	return await ports.reload(current) !== false;
}

async function discardTrackedItem(
	ports: PendingEmptyItemPorts,
	pendingIds: Set<string>,
	forget: (id: string) => void,
	id: string,
	requestCurrent?: () => boolean,
): Promise<boolean> {
	const current = requestCurrent ?? (() => true);
	if (!current()) return false;
	if (!pendingIds.has(id)) return true;
	const item = ports.getSnapshot().items.find((candidate) => candidate.id === id);
	if (!item || item.text.trim()) {
		forget(id);
		return true;
	}
	try {
		await ports.flushAutosave(item.workId);
		return await discardAfterFlush(ports, pendingIds, forget, id, current);
	} catch (cause) {
		if (current()) ports.reportError(cause);
		return false;
	}
}

async function flushRestoredItems(
	ports: PendingEmptyItemPorts,
	forget: (id: string) => void,
	initialPending: readonly string[],
	current: () => boolean,
): Promise<boolean> {
	const snapshot = ports.getSnapshot();
	const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
	const flushedWorkIds = new Set<string>();
	for (const id of initialPending) {
		if (!current()) return false;
		const item = itemById.get(id);
		if (!item || item.text.trim()) {
			forget(id);
			continue;
		}
		if (flushedWorkIds.has(item.workId)) continue;
		flushedWorkIds.add(item.workId);
		try {
			await ports.flushAutosave(item.workId);
		} catch (cause) {
			if (current()) ports.reportError(cause);
			return false;
		}
	}
	return current();
}

function restoredDiscardCandidates(
	ports: PendingEmptyItemPorts,
	pendingIds: Set<string>,
	forget: (id: string) => void,
	initialPending: readonly string[],
): string[] {
	const items = ports.getSnapshot().items;
	const parentIds = new Set(
		items.map((item) => item.parentId).filter((id): id is string => id !== null),
	);
	const candidates: string[] = [];
	for (const id of initialPending) {
		if (!pendingIds.has(id) || ports.isEditing?.(id)) continue;
		const item = items.find((candidate) => candidate.id === id);
		if (!item || item.text.trim() || parentIds.has(id)) forget(id);
		else candidates.push(id);
	}
	return candidates;
}

async function discardRestoredCandidates(
	ports: PendingEmptyItemPorts,
	forget: (id: string) => void,
	candidates: readonly string[],
	current: () => boolean,
): Promise<boolean> {
	let result: DiscardEmptyItemsResult;
	try {
		result = await ports.discardEmptyItems(candidates);
	} catch (cause) {
		if (current()) ports.reportError(cause);
		return false;
	}
	for (const id of result.handledIds) forget(id);
	if (result.deletedIds.length === 0) return current();
	if (!current()) return false;
	return (await ports.reload(current)) !== false;
}

async function discardRestoredItems(
	ports: PendingEmptyItemPorts,
	pendingIds: Set<string>,
	forget: (id: string) => void,
	current: () => boolean,
): Promise<boolean> {
	if (pendingIds.size === 0) return current();
	const initialPending = [...pendingIds];
	if (!await flushRestoredItems(ports, forget, initialPending, current)) return false;
	const candidates = restoredDiscardCandidates(ports, pendingIds, forget, initialPending);
	return candidates.length === 0
		? current()
		: await discardRestoredCandidates(ports, forget, candidates, current);
}

function createPendingStateActions(
	ports: PendingEmptyItemPorts,
	pendingIds: Set<string>,
): {
	track: (id: string) => void;
	forget: (id: string) => void;
	noteTextChange: (id: string, text: string) => void;
} {
	const persist = () => {
		try {
			savePendingEmptyItemIds(pendingIds);
		} catch (cause) {
			ports.reportError(cause);
		}
	};
	const forget = (id: string) => {
		if (pendingIds.delete(id)) persist();
	};
	return {
		track: (id) => {
			pendingIds.add(id);
			persist();
		},
		forget,
		noteTextChange: (id, text) => {
			if (text.trim()) forget(id);
		},
	};
}

export function createPendingEmptyItemController(ports: PendingEmptyItemPorts) {
	const pendingIds = new Set(loadPendingEmptyItemIds());
	const state = createPendingStateActions(ports, pendingIds);
	return {
		...state,
		discard: (id: string, current?: () => boolean) =>
			discardTrackedItem(ports, pendingIds, state.forget, id, current),
		discardRestored: (current = () => true) =>
			discardRestoredItems(ports, pendingIds, state.forget, current),
	};
}
