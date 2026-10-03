import { expect, test, vi } from "vitest";
import type {
	LinkComparisonProjection,
	WorkComparisonDocuments,
} from "../src/services/comparison_service.ts";
import { ComparisonController } from "../src/ui/comparison_controller.svelte.ts";
import { navigationFixture } from "./navigation_fixture.ts";

function setup() {
	const f = navigationFixture();
	const documents: WorkComparisonDocuments = {
		workId: "work-source",
		documents: ["a", "b"].map((id) => ({
			scope: "revision",
			workId: "work-source",
			revisionId: id,
			title: id,
			text: id,
		})),
	};
	const link: LinkComparisonProjection = {
		kind: "semantic-link",
		linkId: "link",
		type: "FROM",
		direction: "directed",
		createdAt: "now",
		left: documents.documents[0],
		right: documents.documents[1],
	};
	const api = {
		listWorkComparisonDocuments: vi.fn(async () => documents),
		resolveLinkComparison: vi.fn(async () => link),
	};
	const controller = new ComparisonController({
		api,
		navigation: f.navigation,
		getSelectedWorkId: () => "work-source",
		getSelectedId: f.selected,
		reportError: f.reportError,
		comparisonPaneLabel: () => "比較",
	});
	f.prepare.mockImplementation(async (destination) => {
		if (!destination?.comparison) return f.presentation;
		const context = await controller.prepareScreen(destination.comparison);
		return () => controller.restoreNavigationContext(context);
	});
	return { ...f, controller, api, documents };
}

for (const kind of ["work", "link"] as const) {
	test(`${kind} preparation failure preserves the current pair and screen`, async () => {
		const s = setup();
		await s.controller.openRevision("a");
		s.controller.selectPair("revision:a", "revision:b");
		const before = s.controller.captureNavigationContext();
		s.api.listWorkComparisonDocuments.mockRejectedValueOnce(new Error("offline"));
		s.api.resolveLinkComparison.mockRejectedValueOnce(new Error("offline"));
		if (kind === "work") await s.controller.openWork("revision", "b");
		else await s.controller.openLink("link");
		expect(s.controller.captureNavigationContext()).toEqual(before);
		expect(s.navigation.view).toBe("comparison");
		expect(s.reportError).toHaveBeenCalledOnce();
	});
	test(`${kind} delayed response cannot publish after Help is requested`, async () => {
		const s = setup();
		let finish!: () => void;
		const waiting = new Promise<void>((resolve) => finish = resolve);
		if (kind === "work") {
			s.api.listWorkComparisonDocuments.mockImplementationOnce(async () => {
				await waiting;
				return s.documents;
			});
		} else {
			const result = await s.api.resolveLinkComparison("link");
			s.api.resolveLinkComparison.mockImplementationOnce(async () => {
				await waiting;
				return result;
			});
		}
		const pending = kind === "work"
			? s.controller.openWork("revision", "b")
			: s.controller.openLink("link");
		await vi.waitFor(() =>
			expect(s.api[kind === "work" ? "listWorkComparisonDocuments" : "resolveLinkComparison"])
				.toHaveBeenCalled()
		);
		await s.navigation.navigate({ view: "help" });
		finish();
		await pending;
		expect(s.navigation.view).toBe("help");
		expect(s.controller.work).toBeNull();
		expect(s.controller.link).toBeNull();
		await s.navigation.goBack();
		expect(s.selected()).toBe("source");
	});
}

test("Work selectors preserve the changed and swapped pair in the feature context", async () => {
	const s = setup();
	await s.controller.openWork("revision", "b");
	s.controller.selectPair("revision:b", "revision:a");
	expect(s.controller.captureNavigationContext().work).toMatchObject({
		preferredLeftKey: "revision:b",
		preferredRightKey: "revision:a",
	});
	s.controller.selectPair("missing", "revision:b");
	expect(s.controller.work?.preferredLeftKey).toBe("revision:b");
});

test("fresh revision comparison resets its feature pair only after accepted navigation", async () => {
	const s = setup();
	await s.controller.openRevision("a");
	s.controller.selectPair("revision:a", "revision:b");
	expect(s.controller.revisionPair).toEqual({ leftKey: "revision:a", rightKey: "revision:b" });
	await s.controller.openRevision("b");
	expect(s.controller.revisionPair).toBeUndefined();
	expect(s.controller.preferredRevisionId).toBe("b");
});

test("preparation itself does not clear or apply the current feature state", async () => {
	const s = setup();
	await s.controller.openRevision("a");
	await s.controller.prepareScreen({
		kind: "work",
		workId: "work-source",
		scope: "revision",
		id: "b",
	});
	expect(s.controller.preferredRevisionId).toBe("a");
	expect(s.controller.work).toBeNull();
});
