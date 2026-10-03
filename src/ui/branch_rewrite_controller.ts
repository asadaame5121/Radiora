import type { OutlineSnapshot } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";
import type { PendingConfirmation } from "./confirmation_controller.svelte.ts";

type RewriteConfirmation = Extract<PendingConfirmation, { action: "rewrite" }>;

/** Owns branch creation and placement; screen history commits with accepted selection. */
export class BranchRewriteController {
	constructor(
		private readonly ports: {
			api: Pick<RadioraBindings, "rewriteAsNewBranch" | "createOccurrence">;
			getSnapshot(): OutlineSnapshot;
			prepareView(): () => void;
			reload(focusId: string, afterSelection: () => void): Promise<unknown>;
			refreshHistory(workId: string): Promise<void>;
		},
	) {}

	async confirmRewrite(confirmation: RewriteConfirmation, branchName: string): Promise<void> {
		const source = this.ports.getSnapshot().items.find((item) =>
			item.id === confirmation.occurrenceId
		);
		if (!source) throw new Error(`別稿の配置元が見つかりません: ${confirmation.occurrenceId}`);
		const commitView = this.ports.prepareView();
		const result = await this.ports.api.rewriteAsNewBranch(
			confirmation.sourceBranchId,
			branchName,
			"confirmed",
		);
		if (result.status !== "created") return;
		const placement = await this.ports.api.createOccurrence({
			workId: confirmation.workId,
			branchId: result.branch.id,
			parentId: source.parentId,
			afterId: source.id,
			contextualHeading: result.branch.name,
		});
		await this.ports.reload(placement.id, commitView);
		await this.ports.refreshHistory(confirmation.workId);
	}
}
