import { expect, test, vi } from "vitest";
import type { Bookmark } from "../src/domain/models.ts";
import { BookmarkController, type BookmarkPorts } from "../src/ui/bookmark_controller.svelte.ts";

function createPorts(overrides: Partial<BookmarkPorts> = {}): BookmarkPorts {
	return {
		read: vi.fn(async () => []),
		createBookmark: vi.fn(),
		deleteBookmark: vi.fn(),
		resolveBookmark: vi.fn(),
		reportError: vi.fn(),
		...overrides,
	};
}

function setup() {
	const read = vi.fn(async (): Promise<Bookmark[]> => []);
	const reportError = vi.fn();
	return {
		controller: new BookmarkController(createPorts({ read, reportError })),
		read,
		reportError,
	};
}

test.each([false, true])("standalone reload retires staged Outline bookmark %s", async (failed) => {
	const s = setup();
	const old = Promise.withResolvers<Bookmark[]>();
	s.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ id: "new" } as Bookmark]);
	const staged = s.controller.prepareRefresh();
	await Promise.resolve();
	await s.controller.reload();
	if (failed) old.reject(new Error("old"));
	else old.resolve([{ id: "old" } as Bookmark]);
	await staged.result;
	staged.publish();
	expect(s.controller.bookmarks[0].id).toBe("new");
	expect(s.reportError).not.toHaveBeenCalled();
});

test("latest failure retains bookmarks and retry succeeds", async () => {
	const s = setup();
	s.read.mockResolvedValueOnce([{ id: "saved" } as Bookmark]).mockRejectedValueOnce(
		new Error("offline"),
	);
	await s.controller.reload();
	await s.controller.reload();
	expect(s.controller.bookmarks[0].id).toBe("saved");
	expect(s.reportError).toHaveBeenCalledTimes(1);
	await s.controller.reload();
	expect(s.controller.bookmarks).toEqual([]);
});

test("cancelled scope cannot revoke newer requests and dispose suppresses delayed failure", async () => {
	const s = setup();
	const old = s.controller.prepareRefresh();
	const latest = s.controller.prepareRefresh();
	old.cancel();
	await latest.result;
	expect(latest.current()).toBe(true);
	const pending = Promise.withResolvers<Bookmark[]>();
	s.read.mockReturnValueOnce(pending.promise);
	const reload = s.controller.reload();
	await Promise.resolve();
	s.controller.dispose();
	pending.reject(new Error("retired"));
	await reload;
	expect(s.reportError).not.toHaveBeenCalled();
});

test("addBookmark creates bookmark and reloads", async () => {
	const createBookmark = vi.fn().mockResolvedValue(undefined);
	const read = vi.fn().mockResolvedValue([{ id: "bm-1" } as Bookmark]);
	const controller = new BookmarkController(createPorts({ read, createBookmark }));

	await controller.addBookmark("occ-1");
	expect(createBookmark).toHaveBeenCalledWith("occ-1");
	expect(read).toHaveBeenCalled();
	expect(controller.bookmarks[0].id).toBe("bm-1");
});

test("removeBookmark deletes bookmark and reloads", async () => {
	const deleteBookmark = vi.fn().mockResolvedValue(undefined);
	const read = vi.fn().mockResolvedValue([]);
	const controller = new BookmarkController(createPorts({ read, deleteBookmark }));

	await controller.removeBookmark("bm-1");
	expect(deleteBookmark).toHaveBeenCalledWith("bm-1");
	expect(read).toHaveBeenCalled();
});

test("resolveBookmark delegates to port", async () => {
	const resolveBookmark = vi.fn().mockResolvedValue({
		target: { kind: "occurrence", occurrenceId: "occ-1" },
	});
	const controller = new BookmarkController(createPorts({ resolveBookmark }));

	const resolved = await controller.resolveBookmark("bm-1");
	expect(resolveBookmark).toHaveBeenCalledWith("bm-1");
	expect(resolved?.target.kind).toBe("occurrence");
});
