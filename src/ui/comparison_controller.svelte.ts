import {
	comparisonDocumentKey,
	type LinkComparisonProjection,
	type WorkComparisonDocuments,
} from "../services/comparison_service.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

type ComparisonApi = Pick<
	RadioraBindings,
	"listWorkComparisonDocuments" | "resolveLinkComparison"
>;

export interface ComparisonPair {
	leftKey: string;
	rightKey: string;
}

export interface ComparisonNavigationContext {
	preferredRevisionId: string | undefined;
	revisionPair?: ComparisonPair;
	link: LinkComparisonProjection | null;
	work:
		| (WorkComparisonDocuments & { preferredLeftKey?: string; preferredRightKey?: string })
		| null;
}

export class ComparisonController {
	preferredRevisionId = $state<string | undefined>();
	revisionPair = $state<ComparisonPair | undefined>();
	link = $state<LinkComparisonProjection | null>(null);
	work = $state<
		(WorkComparisonDocuments & { preferredLeftKey?: string; preferredRightKey?: string }) | null
	>(null);
	private request = 0;

	constructor(
		private readonly ports: {
			api: ComparisonApi;
			getSelectedWorkId(): string | null;
			getSelectedId(): string | null;
			openView(): void;
			reportError(cause: unknown): void;
			comparisonPaneLabel(): string;
		},
	) {}

	captureNavigationContext(): ComparisonNavigationContext {
		return {
			preferredRevisionId: this.preferredRevisionId,
			revisionPair: $state.snapshot(this.revisionPair),
			link: $state.snapshot(this.link),
			work: $state.snapshot(this.work),
		};
	}

	restoreNavigationContext(context: ComparisonNavigationContext): void {
		++this.request;
		this.preferredRevisionId = context.preferredRevisionId;
		this.revisionPair = context.revisionPair;
		this.link = context.link;
		this.work = context.work;
	}

	selectPair(leftKey: string, rightKey: string): void {
		if (this.link || !leftKey || !rightKey || leftKey === rightKey) return;
		if (this.work) {
			const keys = this.work.documents.map(comparisonDocumentKey);
			if (!keys.includes(leftKey) || !keys.includes(rightKey)) return;
			this.work.preferredLeftKey = leftKey;
			this.work.preferredRightKey = rightKey;
		} else {
			this.revisionPair = { leftKey, rightKey };
		}
	}

	openRevision(revisionId: string): void {
		this.ports.openView();
		this.clear();
		this.preferredRevisionId = revisionId;
	}

	async openWork(scope: "branch" | "revision", id: string): Promise<void> {
		const workId = this.ports.getSelectedWorkId();
		if (!workId) return;
		const request = this.clear();
		try {
			const result = await this.ports.api.listWorkComparisonDocuments(workId);
			if (request !== this.request || this.ports.getSelectedWorkId() !== workId) return;
			const selected = result.documents.find((document) =>
				document.scope === scope &&
				(scope === "branch" ? document.branchId === id : document.revisionId === id)
			);
			if (!selected) throw new Error(`${this.ports.comparisonPaneLabel()}対象が見つかりません。`);
			const key = comparisonDocumentKey(selected);
			this.ports.openView();
			this.work = {
				...result,
				...(scope === "revision" ? { preferredRightKey: key } : { preferredLeftKey: key }),
			};
		} catch (cause) {
			if (request !== this.request || this.ports.getSelectedWorkId() !== workId) return;
			this.clearResults();
			this.ports.reportError(cause);
		}
	}

	async openLink(linkId: string): Promise<void> {
		const selectedId = this.ports.getSelectedId();
		const request = this.clear();
		try {
			const result = await this.ports.api.resolveLinkComparison(linkId);
			if (request !== this.request || this.ports.getSelectedId() !== selectedId) return;
			this.ports.openView();
			this.link = result;
		} catch (cause) {
			if (request !== this.request || this.ports.getSelectedId() !== selectedId) return;
			this.clearResults();
			this.ports.reportError(cause);
		}
	}

	private clear(): number {
		this.clearResults();
		return ++this.request;
	}

	private clearResults(): void {
		this.revisionPair = undefined;
		this.link = null;
		this.work = null;
	}
}
