import type { WorkMergePreview } from "../services/work_merge_service.ts";

export type PendingConfirmation =
	| { action: "trash"; occurrenceId: string; occurrenceCount: number }
	| { action: "purge"; workId: string; occurrenceCount: number; linkCount: number }
	| {
		action: "rewrite";
		occurrenceId: string;
		workId: string;
		sourceBranchId: string;
	}
	| { action: "merge-duplicate"; preview: WorkMergePreview }
	| { action: "cancel-longform"; pendingAction: () => Promise<void> };

export function createConfirmationController() {
	let pending = $state<PendingConfirmation | null>(null);
	let submitting = $state(false);
	let rewriteBranchName = $state("");

	return {
		get pending() {
			return pending;
		},
		get submitting() {
			return submitting;
		},
		get rewriteBranchName() {
			return rewriteBranchName;
		},
		set rewriteBranchName(value: string) {
			rewriteBranchName = value;
		},
		request(next: PendingConfirmation): boolean {
			if (pending) return false;
			pending = next;
			return true;
		},
		beginSubmission(): PendingConfirmation | null {
			if (!pending || submitting) return null;
			if (pending.action === "rewrite" && !rewriteBranchName.trim()) return null;
			submitting = true;
			return pending;
		},
		finishSubmission(clear: boolean): void {
			submitting = false;
			if (clear) {
				pending = null;
				rewriteBranchName = "";
			}
		},
		reset(): boolean {
			if (submitting) return false;
			pending = null;
			rewriteBranchName = "";
			return true;
		},
	};
}
