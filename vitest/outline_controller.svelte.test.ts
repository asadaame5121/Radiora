import { expect, test, vi } from "vitest";
import type { Bookmark, OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import type { WorkingCopyDraft } from "../src/services/working_copy_autosave.ts";
import { OutlineController } from "../src/ui/outline_controller.svelte.ts";

function snapshot(text = "saved"): OutlineSnapshot {
	const item: OutlineItem = {
		id: "main",
		workId: "work",
		text,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "main" },
		createdAt: "now",
		updatedAt: "now",
	};
	return {
		items: [
			item,
			{ ...item, id: "same" },
			{
				...item,
				id: "side",
				revisionSelector: { mode: "branch", branchId: "side" },
			},
			{ ...item, id: "pinned", revisionSelector: { mode: "pinned", revisionId: "rev" } },
			{
				...item,
				id: "other",
				workId: "other-work",
			},
		],
		links: [],
		knots: [],
		stashItemIds: [],
	};
}

function draft(text: string): WorkingCopyDraft {
	return {
		workId: "work",
		branchId: "main",
		occurrenceId: "main",
		text,
		status: { workId: "work", branchId: "main", phase: "failed", error: "disk full" },
	};
}

function setup() {
	let drafts: WorkingCopyDraft[] = [];
	let selectionGeneration = 0;
	const treeRequests: {
		result: Promise<void>;
		publish: ReturnType<typeof vi.fn>;
		cancel: ReturnType<typeof vi.fn>;
	}[] = [];
	const ports = {
		readOutline: vi.fn(async () => snapshot()),
		readBookmarks: vi.fn(async (): Promise<Bookmark[]> => []),
		drafts: () => drafts,
		prepareTree: vi.fn(() => {
			const request = { result: Promise.resolve(), publish: vi.fn(), cancel: vi.fn() };
			treeRequests.push(request);
			return request;
		}),
		reconcileSelection: vi.fn(),
		selectionReceipt: () => {
			const captured = selectionGeneration;
			return () => captured === selectionGeneration;
		},
		focus: vi.fn(),
		persist: vi.fn(),
		reportError: vi.fn(),
		clearError: vi.fn(),
	};
	const controller = new OutlineController(ports);
	return {
		controller,
		ports,
		treeRequests,
		setDrafts: (next: WorkingCopyDraft[]) => drafts = next,
		select: () => selectionGeneration++,
	};
}

for (const failed of [false, true]) {
	test(`reverse reload ${failed ? "failure" : "success"} cannot replace snapshot/bookmarks/error/focus`, async () => {
		const s = setup();
		const old = Promise.withResolvers<OutlineSnapshot>();
		s.ports.readOutline.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot("latest"));
		s.ports.readBookmarks.mockResolvedValueOnce([{ id: "old" } as Bookmark]).mockResolvedValueOnce([
			{ id: "latest" } as Bookmark,
		]);
		const first = s.controller.reload({ focusId: "main" });
		expect(await s.controller.reload()).toBe(true);
		if (failed) old.reject(new Error("old failure"));
		else old.resolve(snapshot("old"));
		expect(await first).toBe(false);
		expect(s.controller.snapshot.items[0].text).toBe("latest");
		expect(s.controller.bookmarks[0].id).toBe("latest");
		expect(s.ports.reportError).not.toHaveBeenCalled();
		expect(s.ports.focus).not.toHaveBeenCalled();
		expect(s.treeRequests[0].publish).not.toHaveBeenCalled();
		expect(s.treeRequests[0].cancel).toHaveBeenCalled();
		expect(s.ports.reconcileSelection).toHaveBeenCalledTimes(1);
		expect(s.ports.persist).toHaveBeenCalledTimes(1);
	});
}

test("old finally does not clear loading while the latest bookmark read is pending", async () => {
	const s = setup();
	const old = Promise.withResolvers<OutlineSnapshot>();
	const bookmarks = Promise.withResolvers<Bookmark[]>();
	s.ports.readOutline.mockReturnValueOnce(old.promise);
	s.ports.readBookmarks.mockResolvedValueOnce([]).mockReturnValueOnce(bookmarks.promise);
	const first = s.controller.reload();
	const second = s.controller.reload();
	old.reject(new Error("old"));
	await first;
	expect(s.controller.loading).toBe(true);
	bookmarks.resolve([]);
	await second;
	expect(s.controller.loading).toBe(false);
});

test("latest bookmark failure keeps the existing snapshot and failed draft, then retries", async () => {
	const s = setup();
	s.controller.restoreCache(snapshot());
	s.setDrafts([draft("unsaved")]);
	s.controller.updateText(s.controller.snapshot.items[0], "unsaved", "later");
	const existing = s.controller.snapshot;
	s.ports.readBookmarks.mockRejectedValueOnce(new Error("offline"));
	expect(await s.controller.reload()).toBe(false);
	expect(s.controller.snapshot).toBe(existing);
	expect(s.controller.snapshot.items[0].text).toBe("unsaved");
	expect(s.ports.reportError).toHaveBeenCalledTimes(1);
	expect(await s.controller.reload()).toBe(true);
	expect(s.controller.snapshot.items.map((item) => item.text)).toEqual([
		"unsaved",
		"unsaved",
		"saved",
		"saved",
		"saved",
	]);
	expect(s.ports.persist.mock.lastCall?.[0].items[0].text).toBe("saved");
});

test("input during the read overlays matching Work/branch only, without mutating saved cache", async () => {
	const s = setup();
	s.controller.restoreCache(snapshot());
	const pending = Promise.withResolvers<OutlineSnapshot>();
	s.ports.readOutline.mockReturnValueOnce(pending.promise);
	const reload = s.controller.reload();
	s.setDrafts([draft("new input")]);
	s.controller.updateText(s.controller.snapshot.items[0], "new input", "later");
	const saved = snapshot();
	pending.resolve(saved);
	await reload;
	expect(s.controller.snapshot.items.map((item) => item.text)).toEqual([
		"new input",
		"new input",
		"saved",
		"saved",
		"saved",
	]);
	expect(saved.items.every((item) => item.text === "saved")).toBe(true);
	expect(s.controller.cacheSnapshot).toBe(saved);
});

for (const enteredDuringRead of [false, true]) {
	test(`autosave finishing during read retains ${enteredDuringRead ? "new" : "initial"} input`, async () => {
		const s = setup();
		s.controller.restoreCache(snapshot());
		if (!enteredDuringRead) s.setDrafts([draft("saved during read")]);
		const pending = Promise.withResolvers<OutlineSnapshot>();
		s.ports.readOutline.mockReturnValueOnce(pending.promise);
		const reload = s.controller.reload();
		s.controller.updateText(s.controller.snapshot.items[0], "saved during read", "later");
		s.setDrafts([]);
		pending.resolve(snapshot("old backend response"));
		await reload;
		expect(s.controller.snapshot.items[0].text).toBe("saved during read");
		expect(s.controller.cacheSnapshot.items[0].text).toBe("old backend response");
	});
}

test("cache can preview during startup read but cannot replace accepted formal data", async () => {
	const s = setup();
	const pending = Promise.withResolvers<OutlineSnapshot>();
	s.ports.readOutline.mockReturnValueOnce(pending.promise);
	const reload = s.controller.reload({ treeRequired: false });
	expect(s.controller.restoreCache(snapshot("cache"))).toBe(true);
	pending.resolve(snapshot("formal"));
	expect(await reload).toBe(true);
	expect(s.controller.restoreCache(snapshot("late cache"))).toBe(false);
	expect(s.controller.snapshot.items[0].text).toBe("formal");
	expect(s.ports.prepareTree).toHaveBeenCalledWith(expect.any(Function), false);
});

test("navigation publication revokes staged reload and reload revokes an older navigation read", async () => {
	const s = setup();
	const pending = Promise.withResolvers<OutlineSnapshot>();
	s.ports.readOutline.mockReturnValueOnce(pending.promise);
	const reload = s.controller.reload();
	const navigation = s.controller.begin();
	expect(navigation.publish(snapshot("navigation"))).toBe(true);
	pending.resolve(snapshot("reload"));
	expect(await reload).toBe(false);
	expect(s.controller.snapshot.items[0].text).toBe("navigation");
	const oldNavigation = s.controller.begin();
	await s.controller.reload();
	expect(oldNavigation.publish(snapshot("old navigation"))).toBe(false);
});

test("selection receipt protects focus and a newer publication revokes delayed focus", async () => {
	const s = setup();
	const pending = Promise.withResolvers<OutlineSnapshot>();
	s.ports.readOutline.mockReturnValueOnce(pending.promise);
	const reload = s.controller.reload({ focusId: "main" });
	s.select();
	pending.resolve(snapshot());
	await reload;
	expect(s.ports.focus).not.toHaveBeenCalled();
	await s.controller.reload({ focusId: "main" });
	const current = s.ports.focus.mock.lastCall?.[1];
	expect(current?.()).toBe(true);
	s.controller.begin();
	expect(current?.()).toBe(false);
});

for (const departure of ["dispose", "startup revoked"] as const) {
	test(`${departure} suppresses pending publication and errors`, async () => {
		const s = setup();
		let allowed = true;
		const pending = Promise.withResolvers<OutlineSnapshot>();
		s.ports.readOutline.mockReturnValueOnce(pending.promise);
		const reload = s.controller.reload({ current: () => allowed });
		if (departure === "dispose") s.controller.dispose();
		else allowed = false;
		pending.reject(new Error("retired"));
		expect(await reload).toBe(false);
		expect(s.controller.snapshot.items).toEqual([]);
		expect(s.ports.reportError).not.toHaveBeenCalled();
	});
}

test("an older bookmark response cannot publish after a newer complete reload", async () => {
	const s = setup();
	const pending = Promise.withResolvers<Bookmark[]>();
	s.ports.readBookmarks.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([
		{ id: "new" } as Bookmark,
	]);
	s.ports.readOutline.mockResolvedValueOnce(snapshot("old")).mockResolvedValueOnce(snapshot("new"));
	const first = s.controller.reload();
	await s.controller.reload();
	pending.resolve([{ id: "old" } as Bookmark]);
	expect(await first).toBe(false);
	expect(s.controller.bookmarks[0].id).toBe("new");
	expect(s.controller.snapshot.items[0].text).toBe("new");
});

test("latest draft replaces the read-start draft for each branch", async () => {
	const s = setup();
	s.setDrafts([draft("initial")]);
	const pending = Promise.withResolvers<OutlineSnapshot>();
	s.ports.readOutline.mockReturnValueOnce(pending.promise);
	const reload = s.controller.reload();
	s.setDrafts([draft("latest"), { ...draft("side input"), branchId: "side" }]);
	pending.resolve(snapshot());
	await reload;
	expect(s.controller.snapshot.items.map((item) => item.text)).toEqual([
		"latest",
		"latest",
		"side input",
		"saved",
		"saved",
	]);
});

test("a retired startup reload cannot revoke the current normal reload", async () => {
	const s = setup();
	const pending = Promise.withResolvers<OutlineSnapshot>();
	s.ports.readOutline.mockReturnValueOnce(pending.promise);
	const latest = s.controller.reload();
	expect(await s.controller.reload({ current: () => false })).toBe(false);
	expect(s.controller.loading).toBe(true);
	pending.resolve(snapshot("latest"));
	expect(await latest).toBe(true);
	expect(s.controller.snapshot.items[0].text).toBe("latest");
});
