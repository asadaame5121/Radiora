import { expect, test, vi } from "vitest";
import type { Bookmark } from "../src/domain/models.ts";
import { BookmarkController } from "../src/ui/bookmark_controller.svelte.ts";

function setup() {
	const read = vi.fn(async (): Promise<Bookmark[]> => []);
	const reportError = vi.fn();
	return { controller: new BookmarkController({ read, reportError }), read, reportError };
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
