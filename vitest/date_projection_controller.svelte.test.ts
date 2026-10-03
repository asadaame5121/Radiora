import { expect, test, vi } from "vitest";
import type { DateProjection, DateRange } from "../src/services/date_projection.ts";
import { DateProjectionController } from "../src/ui/date_projection_controller.svelte.ts";
import { navigationFixture } from "./navigation_fixture.ts";

vi.mock("svelte", () => ({ tick: async () => undefined }));

const INITIAL = {
	startInclusive: "2026-09-28T00:00:00.000Z",
	endExclusive: "2026-09-29T00:00:00.000Z",
};
function projection(range: DateRange): DateProjection {
	return { range, created: [], updated: [] };
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function setup() {
	const fixture = navigationFixture();
	const projectDates = vi.fn(async (range: DateRange) => projection(range));
	const dates = new DateProjectionController({
		projectDates,
		navigation: fixture.navigation,
		onError: fixture.reportError,
	});
	fixture.prepare.mockImplementation((destination) =>
		destination.dateRange
			? dates.prepareScreen(destination.dateRange)
			: Promise.resolve(() => undefined)
	);
	dates.setStart("2026-09-28");
	dates.setEnd("2026-09-29");
	return { ...fixture, dates, projectDates };
}

test("accepted range and projection publish together through the common gateway", async () => {
	const s = setup();
	await s.dates.load();
	const original = s.dates.projection;
	const pending = deferred<DateProjection>();
	s.projectDates.mockReturnValueOnce(pending.promise);
	const moving = s.dates.moveRange(1);
	await vi.waitFor(() => expect(s.projectDates).toHaveBeenCalledTimes(2));
	expect(s.navigation.pendingView).toBe("today");
	expect([s.dates.start, s.dates.end]).toEqual(["2026-09-28", "2026-09-29"]);
	expect(s.dates.projection).toBe(original);
	const range = s.projectDates.mock.calls[1][0];
	pending.resolve(projection(range));
	await moving;
	expect([s.dates.start, s.dates.end]).toEqual(["2026-09-29", "2026-09-30"]);
	expect(s.dates.projection?.range).toEqual(range);
	expect(s.navigation.pendingView).toBeNull();
});

test("failed day movement preserves the accepted range and data for retry", async () => {
	const s = setup();
	await s.dates.load();
	const original = s.dates.projection;
	s.projectDates.mockRejectedValueOnce(new Error("offline"));
	await s.dates.moveRange(1);
	expect([s.dates.start, s.dates.end]).toEqual(["2026-09-28", "2026-09-29"]);
	expect(s.dates.projection).toBe(original);
	expect(s.navigation.pendingView).toBeNull();
	expect(s.reportError).toHaveBeenCalledOnce();
	await s.dates.moveRange(1);
	expect(s.dates.start).toBe("2026-09-29");
});

test("custom input remains a draft on failure and does not relabel the accepted projection", async () => {
	const s = setup();
	await s.dates.load();
	s.dates.setStart("2026-10-01");
	s.dates.setEnd("2026-10-05");
	s.projectDates.mockRejectedValueOnce(new Error("offline"));
	await s.dates.load();
	expect(s.dates.projection?.range).toEqual(INITIAL);
	expect([s.dates.start, s.dates.end]).toEqual(["2026-10-01", "2026-10-05"]);
	await s.dates.load();
	expect(s.dates.projection?.range.startInclusive).toBe("2026-10-01T00:00:00.000Z");
});

for (const action of ["openToday", "showWeek"] as const) {
	test(`${action} stages its range until selection and retrieval are accepted`, async () => {
		const s = setup();
		await s.dates.load();
		const original = s.dates.projection;
		const pending = deferred<DateProjection>();
		s.projectDates.mockReturnValueOnce(pending.promise);
		const moving = s.dates[action]();
		await vi.waitFor(() => expect(s.projectDates).toHaveBeenCalledTimes(2));
		expect([s.dates.start, s.dates.end]).toEqual(["2026-09-28", "2026-09-29"]);
		expect(s.dates.projection).toBe(original);
		const range = s.projectDates.mock.calls[1][0];
		pending.resolve(projection(range));
		await moving;
		expect(s.dates.projection?.range).toEqual(range);
	});
}

test("an old completed request cannot clear the loading state of a newer date request", async () => {
	const s = setup();
	await s.dates.load();
	const old = deferred<DateProjection>(), next = deferred<DateProjection>();
	s.projectDates.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
	const first = s.dates.moveRange(1);
	await vi.waitFor(() => expect(s.projectDates).toHaveBeenCalledTimes(2));
	const second = s.dates.moveRange(-1);
	await vi.waitFor(() => expect(s.projectDates).toHaveBeenCalledTimes(3));
	old.resolve(projection(s.projectDates.mock.calls[1][0]));
	await first;
	expect(s.navigation.pendingView).toBe("today");
	expect(s.dates.projection?.range).toEqual(INITIAL);
	next.resolve(projection(s.projectDates.mock.calls[2][0]));
	await second;
	expect(s.dates.start).toBe("2026-09-27");
	expect(s.navigation.pendingView).toBeNull();
});

test("leaving Today clears pending UI immediately and a later response cannot publish the range", async () => {
	const s = setup();
	await s.dates.load();
	const pending = deferred<DateProjection>();
	s.projectDates.mockReturnValueOnce(pending.promise);
	const moving = s.dates.moveRange(1);
	await vi.waitFor(() => expect(s.projectDates).toHaveBeenCalledTimes(2));
	await s.navigation.navigate({ view: "help" });
	expect(s.navigation.pendingView).toBeNull();
	pending.resolve(projection(s.projectDates.mock.calls[1][0]));
	await moving;
	expect(s.navigation.view).toBe("help");
	expect([s.dates.start, s.dates.end]).toEqual(["2026-09-28", "2026-09-29"]);
	expect(s.dates.projection?.range).toEqual(INITIAL);
});

test("saving failure before date preparation retains range and data without requesting dates", async () => {
	const s = setup();
	await s.dates.load();
	const original = s.dates.projection;
	s.save.mockResolvedValueOnce(false);
	await s.dates.moveRange(1);
	expect(s.projectDates).toHaveBeenCalledTimes(1);
	expect(s.dates.projection).toBe(original);
	expect(s.dates.start).toBe("2026-09-28");
	expect(s.navigation.pendingView).toBeNull();
});

test("invalid date drafts report a validation error without requesting or replacing projection", async () => {
	const s = setup();
	await s.dates.load();
	const original = s.dates.projection;
	s.dates.setStart("");
	await s.dates.load();
	expect(s.projectDates).toHaveBeenCalledTimes(1);
	expect(s.dates.projection).toBe(original);
	expect(s.reportError).toHaveBeenCalledWith(
		expect.objectContaining({ message: "開始日と終了日を入力してください。" }),
	);
	expect(s.navigation.pendingView).toBeNull();
});
