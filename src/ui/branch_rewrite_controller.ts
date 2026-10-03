import type { OutlineSnapshot } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";
import type { PendingConfirmation } from "./confirmation_controller.svelte.ts";

import type { ScreenNavigator } from "./screen_navigation_destination.ts";

type RewriteConfirmation = Extract<PendingConfirmation, { action: "rewrite" }>;

/** Owns branch creation and placement; the common gateway accepts the resulting destination. */
export class BranchRewriteController {
	constructor(
		private readonly ports: {
			api: Pick<RadioraBindings, "rewriteAsNewBranch" | "createOccurrence">;
			getSnapshot(): OutlineSnapshot;
			navigation: ScreenNavigator;
			reload(): Promise<unknown>;
			refreshHistory(workId: string): Promise<void>;
		},
	) {}

	async confirmRewrite(confirmation: RewriteConfirmation, branchName: string): Promise<void> {
		const source = this.ports.getSnapshot().items.find((item) =>
			item.id === confirmation.occurrenceId
		);
		if (!source) throw new Error(`別稿の配置元が見つかりません: ${confirmation.occurrenceId}`);
		const origin = this.ports.navigation.origin;
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
		if (await this.ports.reload() === false) return;
		if (
			await this.ports.navigation.navigate({ view: "outline", occurrenceId: placement.id }, origin)
		) {
			await this.ports.refreshHistory(confirmation.workId);
		}
	}
}
