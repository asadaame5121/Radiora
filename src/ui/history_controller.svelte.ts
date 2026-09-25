import type { RecoverySnapshot, Revision } from "../domain/models.ts";
import type { WorkLineageProjection } from "../services/branch_service.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

type HistoryApi = Pick<
	RadioraBindings,
	"listRevisions" | "listRecoverySnapshots" | "listWorkLineage"
>;

export class HistoryController {
	revisions = $state<Revision[]>([]);
	recoverySnapshots = $state<RecoverySnapshot[]>([]);
	revisionsLoading = $state(false);
	workLineage = $state<WorkLineageProjection | null>(null);
	workLineageLoading = $state(false);
	private revisionRequest = 0;
	private recoveryRequest = 0;
	private lineageRequest = 0;

	constructor(
		private readonly api: HistoryApi,
		private readonly getSelectedWorkId: () => string | null,
		private readonly getSelectedBranchId: () => string | null,
		private readonly reportError: (cause: unknown) => void,
	) {}

	clear(): void {
		this.revisionRequest++;
		this.lineageRequest++;
		this.revisions = [];
		this.revisionsLoading = false;
		this.workLineage = null;
		this.workLineageLoading = false;
		this.clearRecovery();
	}

	clearRecovery(): void {
		this.recoveryRequest++;
		this.recoverySnapshots = [];
	}

	async loadRevisions(workId: string): Promise<void> {
		const request = ++this.revisionRequest;
		this.revisionsLoading = true;
		try {
			const next = await this.api.listRevisions(workId);
			if (request === this.revisionRequest && this.getSelectedWorkId() === workId) {
				this.revisions = next;
			}
		} catch (cause) {
			if (request === this.revisionRequest && this.getSelectedWorkId() === workId) {
				this.reportError(cause);
			}
		} finally {
			if (request === this.revisionRequest) this.revisionsLoading = false;
		}
	}

	async loadRecoverySnapshots(workId: string, branchId: string): Promise<void> {
		const request = ++this.recoveryRequest;
		try {
			const next = await this.api.listRecoverySnapshots(workId, branchId);
			if (
				request === this.recoveryRequest && this.getSelectedWorkId() === workId &&
				this.getSelectedBranchId() === branchId
			) this.recoverySnapshots = next;
		} catch (cause) {
			if (
				request === this.recoveryRequest && this.getSelectedWorkId() === workId &&
				this.getSelectedBranchId() === branchId
			) this.reportError(cause);
		}
	}

	async loadWorkLineage(workId: string): Promise<void> {
		const request = ++this.lineageRequest;
		this.workLineageLoading = true;
		try {
			const next = await this.api.listWorkLineage(workId);
			if (request === this.lineageRequest && this.getSelectedWorkId() === workId) {
				this.workLineage = next;
			}
		} catch (cause) {
			if (request === this.lineageRequest && this.getSelectedWorkId() === workId) {
				this.reportError(cause);
			}
		} finally {
			if (request === this.lineageRequest) this.workLineageLoading = false;
		}
	}
}
