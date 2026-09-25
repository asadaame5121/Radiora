import { describe, expect, test, vi } from "vitest";
import type { RecoverySnapshot, Revision } from "../src/domain/models.ts";
import type { WorkLineageProjection } from "../src/services/branch_service.ts";
import { HistoryController } from "../src/ui/history_controller.svelte.ts";

type Api = ConstructorParameters<typeof HistoryController>[0];

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function createApi(overrides: Partial<Api> = {}): Api {
	return {
		listRevisions: vi.fn(async () => []),
		listRecoverySnapshots: vi.fn(async () => []),
		listWorkLineage: vi.fn(async (workId) => lineage(workId)),
		...overrides,
	};
}

function revision(id: string): Revision {
	return { id, workId: "work", text: id, parentRevisionIds: [], kind: "edition", createdAt: "now" };
}

function recovery(id: string, branchId: string): RecoverySnapshot {
	return {
		id,
		workId: "work",
		branchId,
		text: id,
		contentHash: id,
		createdAt: "now",
		sourceRevisionId: null,
	};
}

function lineage(workId: string): WorkLineageProjection {
	return { work: { id: workId, createdAt: "now", updatedAt: "now" }, branches: [], revisions: [] };
}

describe("history controller", () => {
	test("selection loss invalidates revisions, recovery, lineage, and stale errors", async () => {
		let selectedWork: string | null = "work";
		let selectedBranch: string | null = "branch";
		const revisions = deferred<Revision[]>();
		const snapshots = deferred<RecoverySnapshot[]>();
		const workLineage = deferred<WorkLineageProjection>();
		const reportError = vi.fn();
		const controller = new HistoryController(
			createApi({
				listRevisions: vi.fn(() => revisions.promise),
				listRecoverySnapshots: vi.fn(() => snapshots.promise),
				listWorkLineage: vi.fn(() => workLineage.promise),
			}),
			() => selectedWork,
			() => selectedBranch,
			reportError,
		);
		const pending = [
			controller.loadRevisions("work"),
			controller.loadRecoverySnapshots("work", "branch"),
			controller.loadWorkLineage("work"),
		];
		expect(controller.revisionsLoading).toBe(true);
		expect(controller.workLineageLoading).toBe(true);

		selectedWork = null;
		selectedBranch = null;
		controller.clear();
		revisions.resolve([revision("old")]);
		snapshots.resolve([recovery("old", "branch")]);
		workLineage.reject(new Error("stale"));
		await Promise.all(pending);
		expect(controller.revisions).toEqual([]);
		expect(controller.recoverySnapshots).toEqual([]);
		expect(controller.workLineage).toBeNull();
		expect(controller.revisionsLoading).toBe(false);
		expect(controller.workLineageLoading).toBe(false);
		expect(reportError).not.toHaveBeenCalled();
	});

	test("newest responses win and active failures reach the app", async () => {
		let selectedBranch = "branch-a";
		const firstRevisions = deferred<Revision[]>();
		const secondRevisions = deferred<Revision[]>();
		const firstLineage = deferred<WorkLineageProjection>();
		const secondLineage = deferred<WorkLineageProjection>();
		const firstRecovery = deferred<RecoverySnapshot[]>();
		const secondRecovery = deferred<RecoverySnapshot[]>();
		const reportError = vi.fn();
		const api = createApi({
			listRevisions: vi.fn().mockImplementationOnce(() => firstRevisions.promise)
				.mockImplementationOnce(() => secondRevisions.promise),
			listRecoverySnapshots: vi.fn().mockImplementationOnce(() => firstRecovery.promise)
				.mockImplementationOnce(() => secondRecovery.promise),
			listWorkLineage: vi.fn().mockImplementationOnce(() => firstLineage.promise)
				.mockImplementationOnce(() => secondLineage.promise),
		});
		const controller = new HistoryController(api, () => "work", () => selectedBranch, reportError);
		const old = [
			controller.loadRevisions("work"),
			controller.loadWorkLineage("work"),
			controller.loadRecoverySnapshots("work", "branch-a"),
		];
		selectedBranch = "branch-b";
		const current = [
			controller.loadRevisions("work"),
			controller.loadWorkLineage("work"),
			controller.loadRecoverySnapshots("work", "branch-b"),
		];
		secondRevisions.resolve([revision("new")]);
		secondLineage.resolve(lineage("work"));
		secondRecovery.resolve([recovery("new", "branch-b")]);
		await Promise.all(current);
		firstRevisions.resolve([revision("old")]);
		firstLineage.reject(new Error("stale"));
		firstRecovery.resolve([recovery("old", "branch-a")]);
		await Promise.all(old);
		expect(controller.revisions.map((entry) => entry.id)).toEqual(["new"]);
		expect(controller.recoverySnapshots.map((entry) => entry.id)).toEqual(["new"]);
		expect(controller.workLineage?.work.id).toBe("work");
		expect(reportError).not.toHaveBeenCalled();

		vi.mocked(api.listRevisions).mockRejectedValueOnce(new Error("current failure"));
		await controller.loadRevisions("work");
		expect(reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "current failure" }),
		);
		expect(controller.revisionsLoading).toBe(false);
	});
});
