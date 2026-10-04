import { expect, test, vi } from "vitest";
import { navigationFixture } from "./navigation_fixture.ts";

vi.mock("svelte", () => ({ tick: async () => undefined }));

test("direct A→B→A selection prevents an older screen preparation from publishing", async () => {
	const s = navigationFixture();
	const preparation = Promise.withResolvers<() => void>();
	s.prepare.mockReturnValueOnce(preparation.promise);
	const old = s.navigation.navigate({ view: "comparison", occurrenceId: s.other.id });
	await vi.waitFor(() => expect(s.prepare).toHaveBeenCalledOnce());
	s.selection.select(s.other.id);
	s.selection.select(s.source.id);
	preparation.resolve(s.presentation);
	expect(await old).toBe(false);
	expect(s.navigation.view).toBe("outline");
	expect(s.selected()).toBe(s.source.id);
	expect(s.guard.item?.id).toBe(s.source.id);
	expect(s.location().selectedOccurrenceId).toBe(s.source.id);
	expect(s.presentation).not.toHaveBeenCalled();
});

test("new navigation cancels a direct selection guard without applying its destination", async () => {
	const s = navigationFixture();
	s.dirty();
	s.selection.select(s.other.id);
	expect(s.guard.pending?.item?.id).toBe(s.other.id);
	expect(await s.navigation.navigate({ view: "help" })).toBe(true);
	await s.guard.resolvePending("discard");
	expect(s.navigation.view).toBe("help");
	expect(s.selected()).toBe(s.source.id);
	expect(s.guard.item?.id).toBe(s.source.id);
	expect(s.guard.dirty).toBe(true);
});

test("direct selection supersedes a screen guard even when its own guard is cancelled", async () => {
	const s = navigationFixture();
	s.dirty();
	const old = s.navigation.navigate({ view: "outline", occurrenceId: s.other.id });
	await vi.waitFor(() => expect(s.guard.pending?.item?.id).toBe(s.other.id));
	s.selection.select(s.created.id);
	await s.guard.resolvePending("cancel");
	expect(await old).toBe(false);
	expect(s.selected()).toBe(s.source.id);
	expect(s.guard.item?.id).toBe(s.source.id);
	expect(s.location().selectedOccurrenceId).toBe(s.source.id);
	expect(s.presentation).not.toHaveBeenCalled();
});

test("new historical input during screen preparation is guarded again before committing", async () => {
	const s = navigationFixture();
	s.dirty();
	const preparation = Promise.withResolvers<() => void>();
	s.prepare.mockReturnValueOnce(preparation.promise);
	const moving = s.navigation.navigate({ view: "outline", occurrenceId: s.other.id });
	await vi.waitFor(() => expect(s.guard.pending?.item?.id).toBe(s.other.id));
	await s.guard.resolvePending("discard");
	await vi.waitFor(() => expect(s.prepare).toHaveBeenCalledOnce());
	s.guard.draft.original = "input after the guard";
	preparation.resolve(s.presentation);
	await vi.waitFor(() => expect(s.guard.pending?.item?.id).toBe(s.other.id));
	expect(s.selected()).toBe(s.source.id);
	await s.guard.resolvePending("cancel");
	expect(await moving).toBe(false);
	expect(s.guard.draft.original).toBe("input after the guard");
	expect(s.presentation).not.toHaveBeenCalled();
});
