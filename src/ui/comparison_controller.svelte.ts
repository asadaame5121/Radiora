import {
	comparisonDocumentKey,
	type LinkComparisonProjection,
	type WorkComparisonDocuments,
} from "../services/comparison_service.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

import type { ComparisonTarget, ScreenNavigator } from "./screen_navigation_destination.ts";

type ComparisonApi = Pick<
	RadioraBindings,
	"listWorkComparisonDocuments" | "resolveLinkComparison"
>;

export interface ComparisonNavigationContext {
	preferredRevisionId: string | undefined;
	link: LinkComparisonProjection | null;
	work:
		| (WorkComparisonDocuments & { preferredLeftKey?: string; preferredRightKey?: string })
		| null;
}

export class ComparisonController {
	preferredRevisionId = $state<string | undefined>();
	link = $state<LinkComparisonProjection | null>(null);
	work = $state<
		(WorkComparisonDocuments & { preferredLeftKey?: string; preferredRightKey?: string }) | null
	>(null);

	constructor(
		private readonly ports: {
			api: ComparisonApi;
			getSelectedWorkId(): string | null;
			getSelectedId(): string | null;
			navigation: ScreenNavigator;
			reportError(cause: unknown): void;
			comparisonPaneLabel(): string;
		},
	) {}

	restoreNavigationContext(context: ComparisonNavigationContext): void {
		this.preferredRevisionId = context.preferredRevisionId;
		this.link = context.link;
		this.work = context.work;
	}

	openRevision(revisionId: string): Promise<boolean> {
		return this.ports.navigation.navigate({
			view: "comparison",
			comparison: { kind: "revision", revisionId },
		});
	}

	async openWork(scope: "branch" | "revision", id: string): Promise<void> {
		const workId = this.ports.getSelectedWorkId();
		if (workId) {
			await this.ports.navigation.navigate({
				view: "comparison",
				comparison: { kind: "work", workId, scope, id },
			});
		}
	}

	async openLink(linkId: string): Promise<void> {
		await this.ports.navigation.navigate({
			view: "comparison",
			comparison: { kind: "link", linkId },
		});
	}

	/** Resolve into a value. Only the navigation boundary may publish it. */
	async prepareScreen(target: ComparisonTarget): Promise<ComparisonNavigationContext> {
		const empty: ComparisonNavigationContext = {
			preferredRevisionId: undefined,
			link: null,
			work: null,
		};
		if (target.kind === "revision") return { ...empty, preferredRevisionId: target.revisionId };
		if (target.kind === "link") {
			return { ...empty, link: await this.ports.api.resolveLinkComparison(target.linkId) };
		}
		const result = await this.ports.api.listWorkComparisonDocuments(target.workId);
		const selected = result.documents.find((document) =>
			document.scope === target.scope &&
			(target.scope === "branch"
				? document.branchId === target.id
				: document.revisionId === target.id)
		);
		if (!selected) throw new Error(`${this.ports.comparisonPaneLabel()}対象が見つかりません。`);
		const key = comparisonDocumentKey(selected);
		return {
			...empty,
			work: {
				...result,
				...(target.scope === "revision" ? { preferredRightKey: key } : { preferredLeftKey: key }),
			},
		};
	}
}
