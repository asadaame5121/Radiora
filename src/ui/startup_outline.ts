import type { OutlineSnapshot } from "../domain/models.ts";

export type EditorDraft = { workId: string; text: string };

export function prepareLoadedOutline(
	loaded: OutlineSnapshot,
	drafts: readonly EditorDraft[],
): { displaySnapshot: OutlineSnapshot; cacheSnapshot: OutlineSnapshot } {
	const cacheSnapshot: OutlineSnapshot = {
		items: loaded.items,
		links: loaded.links,
		knots: loaded.knots,
		stashItemIds: loaded.stashItemIds,
	};
	const textByWorkId = new Map(drafts.map((draft) => [draft.workId, draft.text]));
	const items = loaded.items.map((item) => {
		const text = textByWorkId.get(item.workId);
		return text === undefined ? item : { ...item, text };
	});
	return { displaySnapshot: { ...loaded, items }, cacheSnapshot };
}
