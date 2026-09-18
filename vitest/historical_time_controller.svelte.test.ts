import { describe, expect, it, vi } from "vitest";
import type { HistoricalTime } from "../src/domain/historical_time.ts";
import type { OutlineItem } from "../src/domain/models.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";

const POINT = {
	kind: "point",
	date: { precision: "year", year: 1604, approximate: false },
	original: "江戸時代",
} satisfies HistoricalTime;

function item(id: string, workId = id, historicalTime?: HistoricalTime): OutlineItem {
	return {
		id,
		workId,
		text: id,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${workId}` },
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		...(historicalTime ? { historicalTime } : {}),
	};
}

function ports(
	save: (workId: string, value: HistoricalTime | null) => Promise<void> = async () => {
		/* noop */
	},
) {
	return {
		save: vi.fn(save),
		reload: vi.fn(async () => undefined),
		select: vi.fn(),
	};
}

describe("HistoricalTimeController", () => {
	it("loads, saves, and deletes a shared Work value", async () => {
		const api = ports();
		const controller = new HistoricalTimeController(api);
		const first = item("occurrence-1", "work-1", POINT);
		const second = item("occurrence-2", "work-1", POINT);

		controller.select(first);
		expect(controller.draft.start.year).toBe("1604");
		controller.draft.original = "江戸初期";
		expect(controller.select(second)).toBe(true);
		expect(controller.item?.id).toBe("occurrence-2");
		expect(controller.draft.original).toBe("江戸初期");
		await expect(controller.save()).resolves.toBe(true);
		expect(api.save).toHaveBeenCalledWith("work-1", {
			kind: "point",
			date: { precision: "year", year: 1604, approximate: false },
			original: "江戸初期",
		});
		expect(controller.dirty).toBe(false);
		expect(api.reload).toHaveBeenCalledOnce();

		await expect(controller.save(true)).resolves.toBe(true);
		expect(api.save).toHaveBeenLastCalledWith("work-1", null);
		expect(controller.item?.historicalTime).toBeUndefined();
	});

	it("keeps invalid input and rejects a reversed period", async () => {
		const api = ports();
		const controller = new HistoricalTimeController(api);
		controller.select(item("occurrence-1"));
		controller.draft.start.year = "not-a-year";

		await expect(controller.save()).resolves.toBe(false);
		expect(controller.draft.start.year).toBe("not-a-year");
		expect(api.save).not.toHaveBeenCalled();

		controller.reset();
		controller.draft.kind = "period";
		controller.draft.start.year = "1867";
		controller.draft.start.unknown = false;
		controller.draft.end.year = "1604";
		controller.draft.end.unknown = false;
		await expect(controller.save()).resolves.toBe(false);
		expect(controller.error).toContain("開始が終了より後");
		expect(api.save).not.toHaveBeenCalled();
	});

	it("carries a point into a known period start when the kind changes", async () => {
		const api = ports();
		const controller = new HistoricalTimeController(api);
		controller.select(item("occurrence-1"));
		controller.draft.start.year = "1604";

		controller.setKind("period");
		controller.draft.end.year = "1867";
		controller.draft.end.unknown = false;

		await expect(controller.save()).resolves.toBe(true);
		expect(api.save).toHaveBeenCalledWith("occurrence-1", {
			kind: "period",
			start: { precision: "year", year: 1604, approximate: false },
			end: { precision: "year", year: 1867, approximate: false },
		});
	});

	it("keeps point precision, era, approximation, and original text on conversion", async () => {
		const api = ports();
		const controller = new HistoricalTimeController(api);
		controller.select(item("occurrence-1"));
		controller.draft.start.precision = "century";
		controller.draft.start.era = "bce";
		controller.draft.start.century = "17";
		controller.draft.start.approximate = true;
		controller.draft.original = "古代の記録";

		controller.setKind("period");
		controller.draft.end.year = "1604";
		controller.draft.end.unknown = false;

		await expect(controller.save()).resolves.toBe(true);
		expect(api.save).toHaveBeenCalledWith("occurrence-1", {
			kind: "period",
			start: { precision: "century", era: "bce", century: 17, approximate: true },
			end: { precision: "year", year: 1604, approximate: false },
			original: "古代の記録",
		});
	});

	it("preserves explicit unknown endpoints and no-ops for the same kind", async () => {
		const api = ports();
		const controller = new HistoricalTimeController(api);
		const unknownPeriod: HistoricalTime = {
			kind: "period",
			start: null,
			end: null,
		};
		controller.select(item("occurrence-1", "work-1", unknownPeriod));
		controller.draft.start.unknown = true;
		controller.setKind("period");
		expect(controller.draft.start.unknown).toBe(true);
		await expect(controller.save()).resolves.toBe(true);
		expect(api.save).toHaveBeenCalledWith("work-1", {
			kind: "period",
			start: null,
			end: null,
		});
	});

	it("keeps dirty input when the save API fails", async () => {
		const api = ports(async () => {
			throw new Error("保存に失敗しました");
		});
		const controller = new HistoricalTimeController(api);
		controller.select(item("occurrence-1"));
		controller.draft.start.year = "1604";
		controller.draft.original = "入力を保持";

		await expect(controller.save()).resolves.toBe(false);
		expect(controller.draft.original).toBe("入力を保持");
		expect(controller.dirty).toBe(true);
		expect(controller.error).toBe("保存に失敗しました");
	});

	it("defers selection changes until dirty input is resolved", async () => {
		const api = ports();
		const controller = new HistoricalTimeController(api);
		const afterSelection = vi.fn();
		const first = item("occurrence-1", "work-1");
		const second = item("occurrence-2", "work-2", POINT);
		controller.select(first);
		controller.draft.original = "未保存";

		expect(controller.select(second, afterSelection)).toBe(false);
		expect(controller.pending?.item).toBe(second);
		await controller.resolvePending("cancel");
		expect(controller.item).toBe(first);
		expect(controller.dirty).toBe(true);
		expect(afterSelection).not.toHaveBeenCalled();

		expect(controller.select(second, afterSelection)).toBe(false);
		await controller.resolvePending("discard");
		expect(controller.item).toBe(second);
		expect(controller.dirty).toBe(false);
		expect(api.select).not.toHaveBeenCalled();
		expect(afterSelection).toHaveBeenCalledOnce();

		controller.draft.original = "保存して移動";
		expect(controller.select(first)).toBe(false);
		await controller.resolvePending("save");
		expect(api.save).toHaveBeenLastCalledWith("work-2", {
			kind: "point",
			date: { precision: "year", year: 1604, approximate: false },
			original: "保存して移動",
		});
		expect(controller.item).toBe(first);
	});
});
