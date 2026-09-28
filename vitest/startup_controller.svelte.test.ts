import { describe, expect, it, vi } from "vitest";
import type { StartupSnapshotCache } from "../src/services/startup_snapshot_cache.ts";
import type { StartupStatus } from "../src/shared/bindings.ts";
import { StartupController } from "../src/ui/startup_controller.svelte.ts";

describe("StartupController", () => {
	function createMockCache(): StartupSnapshotCache {
		return {
			version: 1,
			savedAt: "now",
			location: { selectedOccurrenceId: "item-1", hoistOccurrenceId: null },
			snapshot: {
				items: [],
				works: [],
				branches: [],
				revisions: [],
				recoverySnapshots: [],
				stashItemIds: [],
				knots: [],
				links: [],
				ruleQueries: [],
				bookmarks: [],
				unplacedWorkIds: [],
				relationTypeDefinitions: [],
			},
		};
	}

	it("initializes with starting phase", () => {
		const controller = new StartupController({
			api: {
				getStartupStatus: vi.fn(),
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: String,
		});
		expect(controller.status.phase).toBe("starting");
		expect(controller.cacheActive).toBe(false);
		expect(controller.dataLoaded).toBe(false);
	});

	it("restores cache successfully and notifies callback", async () => {
		const mockCache = createMockCache();
		const onCacheRestored = vi.fn();
		const controller = new StartupController({
			api: {
				getStartupStatus: vi.fn(),
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn().mockResolvedValue(mockCache),
			},
			errorMessage: String,
			onCacheRestored,
		});

		await controller.restoreCache();
		expect(onCacheRestored).toHaveBeenCalledWith(mockCache);
		expect(controller.cacheActive).toBe(true);
	});

	it("tolerates cache load error gracefully", async () => {
		const controller = new StartupController({
			api: {
				getStartupStatus: vi.fn(),
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn().mockRejectedValue(new Error("Corrupt cache")),
			},
			errorMessage: String,
		});

		await controller.restoreCache();
		expect(controller.cacheActive).toBe(false);
	});

	it("monitors startup polling until ready", async () => {
		const readyStatus: StartupStatus = { phase: "ready" };
		const startingStatus: StartupStatus = { phase: "starting", message: "Loading..." };
		const getStartupStatus = vi
			.fn()
			.mockResolvedValueOnce(startingStatus)
			.mockResolvedValueOnce(readyStatus);
		const onReady = vi.fn().mockResolvedValue(undefined);

		const controller = new StartupController({
			api: {
				getStartupStatus,
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: String,
			onReady,
			pollIntervalMs: 5,
		});

		await controller.monitor();
		expect(getStartupStatus).toHaveBeenCalledTimes(2);
		expect(controller.status.phase).toBe("ready");
		expect(onReady).toHaveBeenCalledTimes(1);
	});

	it("captures failure during monitor", async () => {
		const getStartupStatus = vi.fn().mockRejectedValue(new Error("Backend crash"));
		const controller = new StartupController({
			api: {
				getStartupStatus,
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: (cause) => (cause instanceof Error ? cause.message : String(cause)),
			pollIntervalMs: 5,
		});

		await controller.monitor();
		expect(controller.status.phase).toBe("failed");
		expect(controller.status.detail).toBe("Backend crash");
	});

	it("retries startup successfully", async () => {
		const readyStatus: StartupStatus = { phase: "ready" };
		const retryStartup = vi.fn().mockResolvedValue(readyStatus);
		const onReady = vi.fn().mockResolvedValue(undefined);
		const controller = new StartupController({
			api: {
				getStartupStatus: vi.fn(),
				retryStartup,
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: String,
			onReady,
		});

		await controller.retry();
		expect(retryStartup).toHaveBeenCalledTimes(1);
		expect(controller.status.phase).toBe("ready");
		expect(onReady).toHaveBeenCalledTimes(1);
	});

	it("cancels monitoring on dispose", async () => {
		const getStartupStatus = vi.fn().mockResolvedValue({ phase: "starting" });
		const controller = new StartupController({
			api: {
				getStartupStatus,
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: String,
			pollIntervalMs: 10,
		});

		controller.dispose();
		await controller.monitor();
		expect(getStartupStatus).not.toHaveBeenCalled();
	});
});
