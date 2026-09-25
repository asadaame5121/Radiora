import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import {
	WorkingCopyAutosaveCoordinator,
	type WorkingCopySaveStatus,
} from "./working_copy_autosave.ts";

Deno.test("Working Copy autosave debounces edits and saves the latest text", async () => {
	const saves: Array<[string, string]> = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: (id, text) => {
			saves.push([id, text]);
			return Promise.resolve();
		},
		setTimer: (callback) => {
			timers.set(++nextTimer, callback);
			return nextTimer;
		},
		clearTimer: (timer) => typeof timer === "number" && timers.delete(timer),
	});

	coordinator.queue("work", "branch", "occurrence-a", "first");
	coordinator.queue("work", "branch", "occurrence-b", "latest");
	assertEquals(timers.size, 1);
	await coordinator.flush();

	assertEquals(saves, [["occurrence-b", "latest"]]);
	assertEquals(coordinator.hasUnsavedChanges(), false);
	assertEquals(coordinator.statuses(), [{ workId: "work", branchId: "branch", phase: "saved" }]);
});

Deno.test("Working Copy autosave serializes edits queued during a save", async () => {
	const saves: string[] = [];
	let releaseFirst!: () => void;
	const firstSave = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: (_id, text) => {
			saves.push(text);
			return saves.length === 1 ? firstSave : Promise.resolve();
		},
	});

	coordinator.queue("work", "branch", "occurrence", "first");
	const flushing = coordinator.flush();
	await Promise.resolve();
	coordinator.queue("work", "branch", "occurrence", "second");
	releaseFirst();
	await flushing;

	assertEquals(saves, ["first", "second"]);
	assertEquals(coordinator.drafts(), []);
});

Deno.test("Working Copy autosave retains a failed draft and reports retry progress", async () => {
	const statuses: WorkingCopySaveStatus[][] = [];
	const cause = new Error("disk full");
	let attempts = 0;
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: () => {
			attempts++;
			return attempts === 1 ? Promise.reject(cause) : Promise.resolve();
		},
		onStatusChange: (next) => statuses.push(next),
	});

	coordinator.queue("work", "branch", "occurrence", "do not lose");
	const result = await coordinator.flushResult();
	if (result.isErr()) {
		assertEquals(result.error, {
			code: "working-copy-save-failed",
			workId: "work",
			branchId: "branch",
			occurrenceId: "occurrence",
			cause,
		});
		assertStrictEquals(result.error.cause, cause);
	} else {
		throw new Error("expected typed save failure");
	}
	assertEquals(coordinator.drafts()[0], {
		workId: "work",
		branchId: "branch",
		occurrenceId: "occurrence",
		text: "do not lose",
		status: { workId: "work", branchId: "branch", phase: "failed", error: "disk full" },
	});

	await coordinator.retry();
	assertEquals(coordinator.drafts(), []);
	assertEquals(statuses.at(-1), [{ workId: "work", branchId: "branch", phase: "saved" }]);
});

Deno.test("A failed save retains newer text while another Branch saves", async () => {
	const saves: Array<[string, string]> = [];
	const cause = new Error("disk full");
	let rejectFirst!: (cause: unknown) => void;
	const firstSave = new Promise<void>((_resolve, reject) => {
		rejectFirst = reject;
	});
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: (occurrenceId, text) => {
			saves.push([occurrenceId, text]);
			return occurrenceId === "old" ? firstSave : Promise.resolve();
		},
	});

	coordinator.queue("work", "branch-main", "old", "old text");
	coordinator.queue("work", "branch-side", "side", "side text");
	const flushing = coordinator.flushResult();
	await Promise.resolve();
	coordinator.queue("work", "branch-main", "latest", "latest text");
	rejectFirst(cause);

	const result = await flushing;
	if (result.isErr()) assertStrictEquals(result.error.cause, cause);
	else throw new Error("expected typed save failure");
	assertEquals(
		coordinator.drafts().map(({ branchId, occurrenceId, text }) => ({
			branchId,
			occurrenceId,
			text,
		})),
		[{ branchId: "branch-main", occurrenceId: "latest", text: "latest text" }],
	);
	assertEquals(coordinator.statuses().map(({ branchId, phase }) => ({ branchId, phase })), [
		{ branchId: "branch-main", phase: "failed" },
		{ branchId: "branch-side", phase: "saved" },
	]);

	await coordinator.retry("work");
	assertEquals(saves, [
		["old", "old text"],
		["side", "side text"],
		["latest", "latest text"],
	]);
	assertEquals(coordinator.drafts(), []);
});

Deno.test("Working Copy autosave timer consumes save failures and retains the draft", async () => {
	let timerCallback: (() => void) | undefined;
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: () => Promise.reject(new Error("storage unavailable")),
		setTimer: (callback) => {
			timerCallback = callback;
			return 1;
		},
		clearTimer: () => undefined,
	});

	coordinator.queue("work", "branch", "occurrence", "unsaved body");
	if (!timerCallback) throw new Error("expected autosave timer");
	timerCallback();
	await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

	assertEquals(coordinator.drafts()[0].text, "unsaved body");
	assertEquals(coordinator.statuses()[0].phase, "failed");
});

Deno.test("Working Copy flush waits for every Branch and returns the first save failure", async () => {
	const releases = new Map<string, (cause: unknown) => void>();
	const firstCause = new Error("first failure");
	const secondCause = new Error("second failure");
	let settled = false;
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: (occurrenceId) =>
			new Promise<void>((_resolve, reject) => {
				releases.set(occurrenceId, reject);
			}),
	});

	coordinator.queue("work", "branch-first", "first", "first text");
	coordinator.queue("work", "branch-second", "second", "second text");
	const flushing = coordinator.flushResult().then((result) => {
		settled = true;
		return result;
	});
	await Promise.resolve();
	await Promise.resolve();
	const releaseSecond = releases.get("second");
	if (!releaseSecond) throw new Error("expected second Branch save");
	releaseSecond(secondCause);
	await Promise.resolve();
	await Promise.resolve();
	assertEquals(settled, false);
	const releaseFirst = releases.get("first");
	if (!releaseFirst) throw new Error("expected first Branch save");
	releaseFirst(firstCause);

	const result = await flushing;
	if (result.isErr()) assertStrictEquals(result.error.cause, firstCause);
	else throw new Error("expected typed save failure");
});

Deno.test("Working Copy status callback failures remain exceptions, not save failures", async () => {
	const callbackError = new Error("snapshot cache callback failed");
	let attempts = 0;
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: () => {
			attempts++;
			return Promise.resolve();
		},
		onStatusChange: (statuses) => {
			if (statuses[0]?.phase === "saving") throw callbackError;
		},
	});

	coordinator.queue("work", "branch", "occurrence", "text");
	let rejected: unknown;
	try {
		await coordinator.flushResult();
	} catch (cause) {
		rejected = cause;
	}

	assertStrictEquals(rejected, callbackError);
	assertEquals(attempts, 0);
	assertEquals(coordinator.statuses()[0].phase, "saving");
});

Deno.test("Working Copy autosave keeps Branch drafts independent within one Work", async () => {
	const saves: Array<[string, string]> = [];
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: (occurrenceId, text) => {
			saves.push([occurrenceId, text]);
			return Promise.resolve();
		},
	});

	coordinator.queue("work", "branch-main", "main", "main text");
	coordinator.queue("work", "branch-alternate", "alternate", "alternate text");
	await coordinator.flush("work");

	assertEquals(saves.sort(), [["alternate", "alternate text"], ["main", "main text"]]);
});
