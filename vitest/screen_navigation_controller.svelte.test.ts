import { expect, test, vi } from "vitest";
import { ScreenNavigationController } from "../src/ui/screen_navigation_controller.svelte.ts";
import type { ViewMode } from "../src/ui/app_view_mode.ts";

function setup() {
	let selected = "outline-item";
	const prepare = vi.fn(async (destination: { view: ViewMode; selected?: string }) => destination);
	const guard = vi.fn(async () => true);
	const commit = vi.fn((destination: { view: ViewMode; selected?: string }) => {
		if (destination.selected) selected = destination.selected;
	});
	const afterCommit = vi.fn(async (
		_prepared: { view: ViewMode; selected?: string },
		_current: () => boolean,
	) => undefined);
	const navigation = new ScreenNavigationController({
		prepare,
		guard,
		commit,
		afterCommit,
		cancelPending: vi.fn(),
	});
	return { navigation, prepare, guard, commit, afterCommit, selected: () => selected };
}

test("Back always resumes Outline, including after multiple screens", async () => {
	const { navigation } = setup();
	expect(navigation.canGoBack).toBe(false);
	await navigation.navigate({ view: "globalLineage" });
	await navigation.navigate({ view: "help" });
	await navigation.navigate({ view: "outline" });
	expect(navigation.view).toBe("outline");
	expect(navigation.canGoBack).toBe(false);
});

test("guard cancellation changes neither selection nor screen", async () => {
	const { navigation, guard, commit, selected } = setup();
	await navigation.navigate({ view: "today" });
	commit.mockClear();
	guard.mockResolvedValueOnce(false);
	expect(await navigation.navigate({ view: "outline", selected: "destination" })).toBe(false);
	expect(navigation.view).toBe("today");
	expect(selected()).toBe("outline-item");
	expect(commit).not.toHaveBeenCalled();
});

test("an older prepared response cannot change feature state after a newer request", async () => {
	const { navigation, prepare, commit, selected } = setup();
	let resolve!: (value: { view: ViewMode; selected?: string }) => void;
	prepare.mockImplementationOnce(() => new Promise((done) => resolve = done));
	const pending = navigation.navigate({ view: "comparison", selected: "old" });
	await navigation.navigate({ view: "help" });
	commit.mockClear();
	resolve({ view: "comparison", selected: "old" });
	expect(await pending).toBe(false);
	expect(navigation.view).toBe("help");
	expect(selected()).toBe("outline-item");
	expect(commit).not.toHaveBeenCalled();
});

test("a newer cancelled request still invalidates an older guarded request", async () => {
	const { navigation, guard, commit } = setup();
	let accept!: (accepted: boolean) => void;
	guard.mockImplementationOnce(() => new Promise((resolve) => accept = resolve));
	const old = navigation.navigate({ view: "comparison", selected: "old" });
	await vi.waitFor(() => expect(guard).toHaveBeenCalledOnce());
	guard.mockResolvedValueOnce(false);
	await navigation.navigate({ view: "help" });
	accept(true);
	expect(await old).toBe(false);
	expect(navigation.view).toBe("outline");
	expect(commit).not.toHaveBeenCalled();
});

test("origin of a slow domain operation expires even if the user returns to the same screen", async () => {
	const { navigation, commit } = setup();
	const origin = navigation.origin;
	await navigation.navigate({ view: "help" });
	await navigation.navigate({ view: "outline" });
	commit.mockClear();
	expect(await navigation.navigate({ view: "outline", selected: "created" }, origin)).toBe(false);
	expect(commit).not.toHaveBeenCalled();
});

test("preparation failure leaves the current screen and feature state intact", async () => {
	const { navigation, prepare, selected, commit } = setup();
	await navigation.navigate({ view: "help" });
	commit.mockClear();
	prepare.mockRejectedValueOnce(new Error("load failed"));
	await expect(navigation.navigate({ view: "outline" })).rejects.toThrow("load failed");
	expect(navigation.view).toBe("help");
	expect(selected()).toBe("outline-item");
	expect(commit).not.toHaveBeenCalled();
});

test("post-render restoration receives a current-request check", async () => {
	const { navigation, afterCommit } = setup();
	let isCurrent!: () => boolean;
	afterCommit.mockImplementationOnce(async (_destination, current) => {
		isCurrent = current;
	});
	await navigation.navigate({ view: "today" });
	expect(isCurrent()).toBe(true);
	await navigation.navigate({ view: "help" });
	expect(isCurrent()).toBe(false);
});

test("completion of an already pending screen move expires domain receipts captured mid-flight", async () => {
	const { navigation, prepare, commit } = setup();
	let finish!: (destination: { view: ViewMode }) => void;
	prepare.mockImplementationOnce(() => new Promise((resolve) => finish = resolve));
	const moving = navigation.navigate({ view: "help" });
	const origin = navigation.origin;
	finish({ view: "help" });
	await moving;
	commit.mockClear();
	expect(await navigation.navigate({ view: "outline", selected: "created" }, origin)).toBe(false);
	expect(commit).not.toHaveBeenCalled();
});
