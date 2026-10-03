import { describe, expect, test, vi } from "vitest";
import type {
	ComparisonDocument,
	LinkComparisonProjection,
	WorkComparisonDocuments,
} from "../src/services/comparison_service.ts";
import type { ComparisonNavigationContext } from "../src/ui/comparison_controller.svelte.ts";
import { ComparisonController } from "../src/ui/comparison_controller.svelte.ts";
import { ScreenNavigationController } from "../src/ui/screen_navigation_controller.svelte.ts";

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
	test.each(["work", "link"] as const)(
		"a failed %s comparison leaves the caller's displayed pair and navigation unchanged",
		async (kind) => {
			const failure = new Error("offline");
			const commitView = vi.fn();
			const reportError = vi.fn();
			const controller = new ComparisonController({
				api: createApi({
					listWorkComparisonDocuments: vi.fn().mockRejectedValue(failure),
					resolveLinkComparison: vi.fn().mockRejectedValue(failure),
				}),
				getSelectedWorkId: () => "work",
				getSelectedId: () => "item",
				prepareView: () => commitView,
				reportError,
				comparisonPaneLabel: () => "比較",
			});
			controller.openRevision("saved");
			controller.selectPair("revision:b", "revision:a");
			const saved = controller.captureNavigationContext();
			commitView.mockClear();
			if (kind === "work") await controller.openWork("revision", "revision");
			else await controller.openLink("link");
			expect(controller.captureNavigationContext()).toEqual(saved);
			expect(commitView).not.toHaveBeenCalled();
			expect(reportError).toHaveBeenCalledWith(failure);
		},
	);
	test.each(["work", "link"] as const)(
		"opening a %s comparison captures the caller before clearing its comparison state",
		async (kind) => {
			const navigation = new ScreenNavigationController<ComparisonNavigationContext>({
				capture: () => controller.captureNavigationContext(),
				restore: async (context) => {
					controller.restoreNavigationContext(context);
					return true;
				},
			});
			const controller = new ComparisonController({
				api: createApi(),
				getSelectedWorkId: () => "work",
				getSelectedId: () => "item",
				prepareView: () => navigation.prepareOpen("comparison"),
				reportError: vi.fn(),
				comparisonPaneLabel: () => "比較",
			});
			controller.openRevision("saved");
			controller.selectPair("revision:b", "revision:a");
			navigation.open("workLineage");
			if (kind === "work") await controller.openWork("revision", "revision");
			else await controller.openLink("link");
			await navigation.goBack();
			expect(navigation.view).toBe("workLineage");
			expect(controller.captureNavigationContext()).toMatchObject({
				preferredRevisionId: "saved",
				revisionPair: { leftKey: "revision:b", rightKey: "revision:a" },
			});
		},
	);
	test("captures the displayed Work pair after changing and swapping selectors", async () => {
		const controller = new ComparisonController({
			api: createApi({
				listWorkComparisonDocuments: async () => ({
					workId: "work",
					documents: [document("a"), document("b"), document("c")],
				}),
			}),
			getSelectedWorkId: () => "work",
			getSelectedId: () => "item",
			prepareView: () => vi.fn(),
			reportError: vi.fn(),
			comparisonPaneLabel: () => "比較",
		});
		await controller.openWork("revision", "c");
		controller.selectPair("revision:b", "revision:a");
		const saved = controller.captureNavigationContext();
		controller.selectPair("revision:a", "revision:b");
		controller.selectPair("revision:a", "revision:a");
		controller.selectPair("revision:missing", "revision:b");
		expect(controller.work?.preferredLeftKey).toBe("revision:a");
		controller.restoreNavigationContext(saved);
		expect(controller.work?.preferredLeftKey).toBe("revision:b");
		expect(controller.work?.preferredRightKey).toBe("revision:a");
	});

	test("restores an edited revision pair and clears it for a fresh comparison", () => {
		const controller = new ComparisonController({
			api: createApi(),
			getSelectedWorkId: () => "work",
			getSelectedId: () => "item",
			prepareView: () => vi.fn(),
			reportError: vi.fn(),
			comparisonPaneLabel: () => "比較",
		});
		controller.openRevision("c");
		controller.selectPair("revision:b", "revision:a");
		const saved = controller.captureNavigationContext();
		controller.openRevision("d");
		expect(controller.revisionPair).toBeUndefined();
		controller.restoreNavigationContext(saved);
		expect(controller.revisionPair).toEqual({ leftKey: "revision:b", rightKey: "revision:a" });
	});

	test("restores comparison context and invalidates pending comparison requests", async () => {
		const pending = deferred<LinkComparisonProjection>();
		const openView = vi.fn();
		const controller = new ComparisonController({
			api: createApi({ resolveLinkComparison: () => pending.promise }),
			getSelectedWorkId: () => "work",
			getSelectedId: () => "item",
			prepareView: () => openView,
			reportError: vi.fn(),
			comparisonPaneLabel: () => "比較",
		});
		controller.openRevision("saved");
		const saved = controller.captureNavigationContext();
		const request = controller.openLink("pending");
		controller.restoreNavigationContext(saved);
		pending.resolve(linkProjection("pending"));
		await request;
		expect(controller.preferredRevisionId).toBe("saved");
		expect(controller.link).toBeNull();
		expect(openView).toHaveBeenCalledOnce();
	});

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
			prepareView: () => openView,
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
			prepareView: () => openView,
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
