const STORAGE_KEY = "radiora.pendingEmptyItemIds";

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function loadPendingEmptyItemIds(): string[] {
	try {
		const raw = browserStorage()?.getItem(STORAGE_KEY);
		if (!raw) return [];
		const ids: unknown = JSON.parse(raw);
		return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : [];
	} catch {
		return [];
	}
}

export function savePendingEmptyItemIds(ids: Iterable<string>): void {
	browserStorage()?.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}
