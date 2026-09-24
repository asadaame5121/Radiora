import { describe, expect, test, vi } from "vitest";
import type {
	ComparisonDocument,
	LinkComparisonProjection,
	WorkComparisonDocuments,
} from "../src/services/comparison_service.ts";
import { ComparisonController } from "../src/ui/comparison_controller.svelte.ts";

type Ports = ConstructorParameters<typeof ComparisonController>[0];
type Api = Ports["api"];

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function document(id: string): ComparisonDocument {
	return { scope: "revision", workId: "work", revisionId: id, title: id, text: id };
}

function workDocuments(id: string): WorkComparisonDocuments {
	return { workId: "work", documents: [document(id)] };
}

function linkProjection(id: string): LinkComparisonProjection {
	return {
		kind: "semantic-link",
		linkId: id,
		type: "FROM",
		direction: "directed",
		createdAt: "now",
		left: document("left"),
		right: document("right"),
	};
}

function createApi(overrides: Partial<Api> = {}): Api {
	return {
		listWorkComparisonDocuments: vi.fn(async () => workDocuments("revision")),
		resolveLinkComparison: vi.fn(async (id) => linkProjection(id)),
		...overrides,
	};
}

describe("comparison controller", () => {
	test("revision, Work, and Link entry points share one request generation", async () => {
		const work = deferred<WorkComparisonDocuments>();
		const link = deferred<LinkComparisonProjection>();
		const openView = vi.fn();
		const reportError = vi.fn();
		const controller = new ComparisonController({
			api: createApi({
				listWorkComparisonDocuments: vi.fn(() => work.promise),
				resolveLinkComparison: vi.fn(() => link.promise),
			}),
			getSelectedWorkId: () => "work",
			getSelectedId: () => "item",
			openView,
			reportError,
			comparisonPaneLabel: () => "比較",
		});
		const oldWork = controller.openWork("revision", "revision");
		controller.openRevision("chosen");
		work.resolve(workDocuments("revision"));
		await oldWork;
		expect(controller.work).toBeNull();
		expect(controller.preferredRevisionId).toBe("chosen");

		const oldLink = controller.openLink("link");
		const currentWork = controller.openWork("revision", "revision");
		link.reject(new Error("stale"));
		await oldLink;
		work.resolve(workDocuments("revision"));
		await currentWork;
		expect(controller.link).toBeNull();
		expect(controller.work?.preferredRightKey).toBe("revision:revision");
		expect(openView).toHaveBeenCalledTimes(2);
		expect(reportError).not.toHaveBeenCalled();
	});

	test("selection changes suppress stale responses and current failures report errors", async () => {
		let selectedWork = "work";
		let selectedId = "item";
		const pendingWork = deferred<WorkComparisonDocuments>();
		const pendingLink = deferred<LinkComparisonProjection>();
		const reportError = vi.fn();
		const openView = vi.fn();
		const api = createApi({
			listWorkComparisonDocuments: vi.fn().mockImplementationOnce(() => pendingWork.promise)
				.mockResolvedValue(workDocuments("revision")),
			resolveLinkComparison: vi.fn().mockImplementationOnce(() => pendingLink.promise)
				.mockRejectedValueOnce(new Error("current failure")),
		});
		const controller = new ComparisonController({
			api,
			getSelectedWorkId: () => selectedWork,
			getSelectedId: () => selectedId,
			openView,
			reportError,
			comparisonPaneLabel: () => "比較",
		});
		const staleWork = controller.openWork("revision", "revision");
		selectedWork = "other";
		pendingWork.resolve(workDocuments("revision"));
		await staleWork;
		expect(controller.work).toBeNull();
		const staleLink = controller.openLink("link");
		selectedId = "other-item";
		pendingLink.reject(new Error("stale"));
		await staleLink;
		expect(controller.link).toBeNull();
		expect(reportError).not.toHaveBeenCalled();
		expect(openView).not.toHaveBeenCalled();

		await controller.openLink("current-link");
		expect(reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "current failure" }),
		);
		expect(controller.link).toBeNull();
	});
});
