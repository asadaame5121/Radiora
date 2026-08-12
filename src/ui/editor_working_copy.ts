import type { OutlineItem } from "../domain/models.ts";

export interface BranchWorkingCopyDraft {
	workId: string;
	branchId: string;
	text: string;
}

export function applyBranchWorkingCopyText(
	items: readonly OutlineItem[],
	editedItem: OutlineItem,
	text: string,
	updatedAt: string,
): void {
	if (editedItem.revisionSelector.mode !== "branch") return;
	const branchId = editedItem.revisionSelector.branchId;
	for (const placement of items) {
		if (
			placement.workId === editedItem.workId && placement.revisionSelector.mode === "branch" &&
			placement.revisionSelector.branchId === branchId
		) {
			placement.text = text;
			placement.updatedAt = updatedAt;
		}
	}
}

export function rehydrateBranchWorkingCopyDrafts(
	items: readonly OutlineItem[],
	drafts: readonly BranchWorkingCopyDraft[],
): OutlineItem[] {
	const draftsByWork = new Map<string, Map<string, string>>();
	for (const draft of drafts) {
		const draftsByBranch = draftsByWork.get(draft.workId) ?? new Map<string, string>();
		draftsByBranch.set(draft.branchId, draft.text);
		draftsByWork.set(draft.workId, draftsByBranch);
	}

	return items.map((item) => {
		if (item.revisionSelector.mode !== "branch") return item;
		const draft = draftsByWork.get(item.workId)?.get(item.revisionSelector.branchId);
		return draft === undefined ? item : { ...item, text: draft };
	});
}
