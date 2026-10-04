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
				stashItemIds: [],
				knots: [],
				links: [],
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
		const onCacheRestored = vi.fn(() => true);
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

	it("restores failed retryable status when onReady rejects before markDataLoaded during monitor", async () => {
		const readyStatus: StartupStatus = { phase: "ready" };
		const getStartupStatus = vi.fn().mockResolvedValue(readyStatus);
		const onReady = vi.fn().mockRejectedValue(new Error("relationTypes load failed"));
		const controller = new StartupController({
			api: {
				getStartupStatus,
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: (cause) => (cause instanceof Error ? cause.message : String(cause)),
			onReady,
			pollIntervalMs: 5,
		});

		await controller.monitor();
		expect(controller.status.phase).toBe("failed");
		expect(controller.status.detail).toBe("relationTypes load failed");
	});

	it("restores failed retryable status when onReady rejects before markDataLoaded during retry", async () => {
		const readyStatus: StartupStatus = { phase: "ready" };
		const retryStartup = vi.fn().mockResolvedValue(readyStatus);
		const onReady = vi.fn().mockRejectedValue(new Error("load failed"));
		const controller = new StartupController({
			api: {
				getStartupStatus: vi.fn(),
				retryStartup,
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: (cause) => (cause instanceof Error ? cause.message : String(cause)),
			onReady,
		});

		await controller.retry();
		expect(controller.status.phase).toBe("failed");
		expect(controller.status.detail).toBe("load failed");
	});

	it("preserves ready status when onReady rejects after markDataLoaded", async () => {
		const readyStatus: StartupStatus = { phase: "ready" };
		let controllerInstance!: StartupController;
		const onReady = vi.fn().mockImplementation(async () => {
			controllerInstance.markDataLoaded();
			throw new Error("post-load alias failed");
		});
		controllerInstance = new StartupController({
			api: {
				getStartupStatus: vi.fn().mockResolvedValue(readyStatus),
				retryStartup: vi.fn(),
				loadStartupSnapshotCache: vi.fn(),
			},
			errorMessage: String,
			onReady,
			pollIntervalMs: 5,
		});

		await controllerInstance.monitor();
		expect(controllerInstance.status.phase).toBe("ready");
	});

	it("aborts monitor if disposed during in-flight getStartupStatus", async () => {
		let resolveStatus!: (value: StartupStatus) => void;
		const statusPromise = new Promise<StartupStatus>((resolve) => {
			resolveStatus = resolve;
		});
		const getStartupStatus = vi.fn().mockReturnValue(statusPromise);
		const onReady = vi.fn();
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

		const monitorPromise = controller.monitor();
		// dispose while getStartupStatus is in-flight
		controller.dispose();
		resolveStatus({ phase: "ready" });
		await monitorPromise;

		expect(controller.status.phase).toBe("starting");
		expect(onReady).not.toHaveBeenCalled();
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup() {
	const api = {
		getStartupStatus: vi.fn<() => Promise<StartupStatus>>().mockResolvedValue({ phase: "ready" }),
		retryStartup: vi.fn<() => Promise<StartupStatus>>().mockResolvedValue({ phase: "ready" }),
		loadStartupSnapshotCache: vi.fn<() => Promise<StartupSnapshotCache | null>>().mockResolvedValue(
			null,
		),
	};
	const onCacheRestored = vi.fn(() => true);
	const onReady = vi.fn<(current: () => boolean) => Promise<void>>().mockResolvedValue();
	const onReadyError = vi.fn();
	const controller = new StartupController({
		api,
		onCacheRestored,
		onReady,
		onReadyError,
		errorMessage: String,
	});
	return { controller, api, onReady, onCacheRestored, onReadyError };
}

const cache: StartupSnapshotCache = {
	version: 1,
	savedAt: "now",
	location: { selectedOccurrenceId: null, hoistOccurrenceId: null },
	snapshot: { items: [], links: [], knots: [], stashItemIds: [] },
};

describe("StartupController publication authority", () => {
	it("only activates an accepted cache restoration", async () => {
		const { controller, api, onCacheRestored } = setup();
		api.loadStartupSnapshotCache.mockResolvedValue(cache);
		onCacheRestored.mockReturnValue(false);
		await controller.restoreCache();
		expect(controller.cacheActive).toBe(false);
	});

	for (const departure of ["dispose", "retry", "normal load", "data loaded"] as const) {
		it(`does not publish a delayed cache after ${departure}`, async () => {
			const { controller, api, onCacheRestored } = setup();
			const pending = deferred<StartupSnapshotCache | null>();
			api.loadStartupSnapshotCache.mockReturnValue(pending.promise);
			const restoring = controller.restoreCache();
			if (departure === "dispose") controller.dispose();
			if (departure === "retry") await controller.retry();
			if (departure === "normal load") controller.invalidateDataLoad();
			if (departure === "data loaded") controller.markDataLoaded();
			pending.resolve(cache);
			await restoring;
			expect(onCacheRestored).not.toHaveBeenCalled();
			expect(controller.cacheActive).toBe(false);
		});
	}

	for (const failure of [false, true]) {
		it(`ignores the old poll ${failure ? "failure" : "success"} after retry`, async () => {
			const { controller, api, onReady } = setup();
			const pending = deferred<StartupStatus>();
			api.getStartupStatus.mockReturnValue(pending.promise);
			const monitoring = controller.monitor();
			await controller.retry();
			if (failure) pending.reject(new Error("old poll"));
			else pending.resolve({ phase: "failed", detail: "old poll" });
			await monitoring;
			expect(controller.status.phase).toBe("ready");
			expect(onReady).toHaveBeenCalledTimes(1);
		});

		it(`ignores retry ${failure ? "failure" : "success"} after dispose and restart`, async () => {
			const { controller, api, onReady } = setup();
			const pending = deferred<StartupStatus>();
			api.retryStartup.mockReturnValue(pending.promise);
			const retrying = controller.retry();
			controller.dispose();
			await controller.start();
			if (failure) pending.reject(new Error("old retry"));
			else pending.resolve({ phase: "failed" });
			await retrying;
			expect(controller.status.phase).toBe("ready");
			expect(onReady).toHaveBeenCalledTimes(1);
		});
	}

	it("keeps the latest retry when responses arrive in reverse order", async () => {
		const { controller, api, onReady } = setup();
		const pending = deferred<StartupStatus>();
		api.retryStartup.mockReturnValueOnce(pending.promise);
		const first = controller.retry();
		await controller.retry();
		pending.resolve({ phase: "failed" });
		await first;
		expect(controller.status.phase).toBe("ready");
		expect(onReady).toHaveBeenCalledTimes(1);
	});

	it("reports retry RPC failure and preserves the cache preview", async () => {
		const { controller, api } = setup();
		api.loadStartupSnapshotCache.mockResolvedValue(cache);
		await controller.restoreCache();
		api.retryStartup.mockRejectedValue(new Error("retry offline"));
		await controller.retry();
		expect(controller.status.phase).toBe("failed");
		expect(controller.status.detail).toContain("retry offline");
		expect(controller.cacheActive).toBe(true);
	});

	it("revokes old initial data publication and errors when a normal load starts", async () => {
		const { controller, onReady, onReadyError } = setup();
		const pending = deferred<void>();
		let publication: (() => boolean) | undefined;
		onReady.mockImplementation(async (current) => {
			publication = current;
			await pending.promise;
			controller.markDataLoaded(current);
			throw new Error("old initial data");
		});
		const monitoring = controller.monitor();
		await vi.waitFor(() => expect(publication).toBeDefined());
		controller.invalidateDataLoad();
		pending.resolve();
		await monitoring;
		expect(publication?.()).toBe(false);
		expect(controller.dataLoaded).toBe(false);
		expect(controller.status.phase).toBe("ready");
		expect(onReadyError).not.toHaveBeenCalled();
	});

	it("reports post-load failure without replacing the usable ready shell", async () => {
		const { controller, onReady, onReadyError } = setup();
		const cause = new Error("tags offline");
		onReady.mockImplementation(async (current) => {
			controller.markDataLoaded(current);
			throw cause;
		});
		await controller.monitor();
		expect(controller.status.phase).toBe("ready");
		expect(onReadyError).toHaveBeenCalledWith(cause);
	});

	it("releases a scheduled poll immediately on dispose", async () => {
		vi.useFakeTimers();
		try {
			const { controller, api } = setup();
			api.getStartupStatus.mockResolvedValue({ phase: "starting" });
			const monitoring = controller.monitor();
			await Promise.resolve();
			expect(vi.getTimerCount()).toBe(1);
			controller.dispose();
			await monitoring;
			expect(vi.getTimerCount()).toBe(0);
			expect(api.getStartupStatus).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("startup cache and retry request ordering", () => {
	it("rejects an older cache read even in the same startup session", async () => {
		const { controller, api, onCacheRestored } = setup();
		const pending = deferred<StartupSnapshotCache | null>();
		api.loadStartupSnapshotCache.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(cache);
		const first = controller.restoreCache();
		await controller.restoreCache();
		pending.resolve(cache);
		await first;
		expect(onCacheRestored).toHaveBeenCalledTimes(1);
	});

	it("continues polling when retry returns an intermediate starting phase", async () => {
		const { controller, api, onReady } = setup();
		api.retryStartup.mockResolvedValue({ phase: "starting" });
		await controller.retry();
		expect(api.getStartupStatus).toHaveBeenCalledTimes(1);
		expect(controller.status.phase).toBe("ready");
		expect(onReady).toHaveBeenCalledTimes(1);
	});
});
