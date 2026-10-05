import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import type { WorkingCopyDraft } from "../services/working_copy_autosave.ts";

/** Saved data stays untouched; only the matching Work and branch may display a draft. */
export function overlayDrafts(
	snapshot: OutlineSnapshot,
	drafts: readonly WorkingCopyDraft[],
): OutlineSnapshot {
	const byWork = new Map<string, Map<string, string>>();
	for (const draft of drafts) {
		let branches = byWork.get(draft.workId);
		if (!branches) {
			branches = new Map();
			byWork.set(draft.workId, branches);
		}
		branches.set(draft.branchId, draft.text);
	}
	return {
		...snapshot,
		items: snapshot.items.map((item) => {
			const selector = item.revisionSelector;
			const text = selector.mode === "branch"
				? byWork.get(item.workId)?.get(selector.branchId)
				: undefined;
			return { ...item, text: text ?? item.text };
		}),
	};
}

/** Collision-safe identity used only to remember edits admitted during a read. */
export function branchKey(item: OutlineItem): string {
	return JSON.stringify([item.workId, item.revisionSelector]);
}
