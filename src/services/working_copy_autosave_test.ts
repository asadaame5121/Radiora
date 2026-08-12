import { assertEquals, assertRejects } from "jsr:@std/assert@1";
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

	coordinator.queue("work", "occurrence-a", "first");
	coordinator.queue("work", "occurrence-b", "latest");
	assertEquals(timers.size, 1);
	await coordinator.flush();

	assertEquals(saves, [["occurrence-b", "latest"]]);
	assertEquals(coordinator.hasUnsavedChanges(), false);
	assertEquals(coordinator.statuses(), [{ workId: "work", phase: "saved" }]);
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

	coordinator.queue("work", "occurrence", "first");
	const flushing = coordinator.flush();
	await Promise.resolve();
	coordinator.queue("work", "occurrence", "second");
	releaseFirst();
	await flushing;

	assertEquals(saves, ["first", "second"]);
	assertEquals(coordinator.drafts(), []);
});

Deno.test("Working Copy autosave retains a failed draft and reports retry progress", async () => {
	const statuses: WorkingCopySaveStatus[][] = [];
	let attempts = 0;
	const coordinator = new WorkingCopyAutosaveCoordinator({
		save: () => {
			attempts++;
			return attempts === 1 ? Promise.reject(new Error("disk full")) : Promise.resolve();
		},
		onStatusChange: (next) => statuses.push(next),
	});

	coordinator.queue("work", "occurrence", "do not lose");
	await assertRejects(() => coordinator.flush(), Error, "disk full");
	assertEquals(coordinator.drafts()[0], {
		workId: "work",
		occurrenceId: "occurrence",
		text: "do not lose",
		status: { workId: "work", phase: "failed", error: "disk full" },
	});

	await coordinator.retry();
	assertEquals(coordinator.drafts(), []);
	assertEquals(statuses.at(-1), [{ workId: "work", phase: "saved" }]);
});
