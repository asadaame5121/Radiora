import { assertEquals } from "jsr:@std/assert@1";
import { ResumePositionAutosaveCoordinator } from "./resume_position_autosave.ts";

Deno.test("resume autosave debounces to the latest caret", async () => {
	const saves: Array<[string, number]> = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	const coordinator = new ResumePositionAutosaveCoordinator({
		save: (occurrenceId, caretOffset) => {
			saves.push([occurrenceId, caretOffset]);
			return Promise.resolve();
		},
		setTimer: (callback) => {
			timers.set(++nextTimer, callback);
			return nextTimer;
		},
		clearTimer: (timer) => timers.delete(timer),
	});

	coordinator.queue("first", 1);
	coordinator.queue("latest", 9);
	assertEquals(timers.size, 1);
	await coordinator.flush();
	assertEquals(saves, [["latest", 9]]);
});

Deno.test("resume autosave serializes in-flight writes and finishes with the latest value", async () => {
	const saves: Array<[string, number]> = [];
	let releaseFirst!: () => void;
	const first = new Promise<void>((resolve) => releaseFirst = resolve);
	const coordinator = new ResumePositionAutosaveCoordinator({
		save: (occurrenceId, caretOffset) => {
			saves.push([occurrenceId, caretOffset]);
			return saves.length === 1 ? first : Promise.resolve();
		},
	});

	coordinator.queue("occurrence", 1);
	const flushing = coordinator.flush();
	await Promise.resolve();
	coordinator.queue("occurrence", 2);
	coordinator.queue("other", 3);
	releaseFirst();
	await flushing;

	assertEquals(saves, [["occurrence", 1], ["other", 3]]);
});
