import { describe, expect, it, vi } from "vitest";
import type { DateProjection } from "../src/domain/models.ts";
import { DateProjectionController } from "../src/ui/date_projection_controller.svelte.ts";

function createMockProjection(): DateProjection {
	return {
		range: { start: "2026-09-28T00:00:00.000Z", end: "2026-09-29T00:00:00.000Z" },
		created: [],
		updated: [],
	};
}

describe("DateProjectionController", () => {
	it("initializes with today range and null projection", () => {
		const controller = new DateProjectionController({
			projectDates: vi.fn(),
			onError: vi.fn(),
			navigation: { origin: 0, navigate: vi.fn(async () => true) },
		});
		expect(controller.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(controller.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(controller.projection).toBeNull();
		expect(controller.loading).toBe(false);
	});

	it("loads projection successfully and triggers onOpenView", async () => {
		const mockData = createMockProjection();
		const projectDates = vi.fn().mockResolvedValue(mockData);
		const onOpenView = vi.fn();
		const controller = new DateProjectionController({
			projectDates,
			onError: vi.fn(),
			navigation: { origin: 0, navigate: onOpenView.mockResolvedValue(true) },
		});

		(await controller.prepareScreen({
			startInclusive: "2026-09-28",
			endExclusive: "2026-09-29",
		}))();
		await controller.load();

		expect(projectDates).toHaveBeenCalledTimes(1);
		expect(controller.projection).toBe(mockData);
		expect(controller.loading).toBe(false);
		expect(onOpenView).toHaveBeenCalledWith(expect.objectContaining({ view: "today" }));
	});

	it("handles load error cleanly", async () => {
		const error = new Error("Network error");
		const projectDates = vi.fn().mockRejectedValue(error);
		const onError = vi.fn();
		const controller = new DateProjectionController({
			projectDates,
			onError,
			navigation: { origin: 0, navigate: vi.fn(async () => true) },
		});

		await expect(
			controller.prepareScreen({ startInclusive: "2026-09-28", endExclusive: "2026-09-29" }),
		).rejects.toThrow(error);
	});

	it("moves date range forward and backward", async () => {
		const projectDates = vi.fn().mockResolvedValue(createMockProjection());
		const controller = new DateProjectionController({
			projectDates,
			onError: vi.fn(),
			navigation: { origin: 0, navigate: vi.fn(async () => true) },
		});
		controller.setStart("2026-09-01");
		controller.setEnd("2026-09-02");

		await controller.moveRange(1);
		expect(controller.start).toBe("2026-09-02");
		expect(controller.end).toBe("2026-09-03");

		await controller.moveRange(-2);
		expect(controller.start).toBe("2026-08-31");
		expect(controller.end).toBe("2026-09-01");
	});

	it("sets range to week on showWeek", async () => {
		const projectDates = vi.fn().mockResolvedValue(createMockProjection());
		const controller = new DateProjectionController({
			projectDates,
			onError: vi.fn(),
			navigation: { origin: 0, navigate: vi.fn(async () => true) },
		});

		await controller.showWeek();
		const startDate = new Date(`${controller.start}T00:00:00`);
		// Monday is day 1 in JavaScript getDay()
		expect(startDate.getDay()).toBe(1);
	});
});
