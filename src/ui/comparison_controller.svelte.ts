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

export class ComparisonController {
	preferredRevisionId = $state<string | undefined>();
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

	openRevision(revisionId: string): void {
		this.clear();
		this.preferredRevisionId = revisionId;
		this.ports.openView();
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
			this.work = {
				...result,
				...(scope === "revision" ? { preferredRightKey: key } : { preferredLeftKey: key }),
			};
			this.ports.openView();
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
			this.link = result;
			this.ports.openView();
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
		this.link = null;
		this.work = null;
	}
}
