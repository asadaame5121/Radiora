import type { OutlineItem } from "../domain/models.ts";

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
