import { describe, expect, test, vi } from "vitest";
import type { EmergenceSuggestion } from "../src/domain/models.ts";
import {
	createEmergenceController,
	type EmergenceApiPort,
	type EmergenceControllerPorts,
} from "../src/ui/emergence_controller.svelte.ts";

const LIMIT = 10;

function suggestion(id: string, overrides: Partial<EmergenceSuggestion> = {}): EmergenceSuggestion {
	return {
		id,
		kind: "latent-relation",
		contextWorkId: "work-a",
		targetWorkId: "work-b",
		contextItemId: "item-a",
		targetItemId: "item-b",
		title: `${id} title`,
		explanation: `${id} explanation`,
		evidence: [{ fromId: "work-a", toId: "work-b", relation: "RELATED" }],
		score: 1,
		persistenceStatus: "pending",
		createdAt: "2026-08-17T00:00:00.000Z",
		updatedAt: "2026-08-17T00:00:00.000Z",
		...overrides,
	};
}

function createPorts(
	apiOverrides: Partial<EmergenceApiPort> = {},
	portOverrides: Partial<EmergenceControllerPorts> = {},
): EmergenceControllerPorts {
	return {
		api: {
			listEmergenceSuggestions: vi.fn(async () => []),
			resolveEmergenceSuggestion: vi.fn(async () => undefined),
			...apiOverrides,
		},
		getSelectedId: () => "item-a",
		titleForId: (id) => `title(${id})`,
		reloadOutline: vi.fn(async () => undefined),
		reportError: vi.fn(),
		...portOverrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe("emergence controller", () => {
	test("exposes empty feature state before loading", () => {
		const controller = createEmergenceController(createPorts());

		expect(controller.suggestions).toEqual([]);
		expect(controller.resolutionReasons).toEqual({});
		expect(controller.loading).toBe(false);
		expect(controller.toast).toBeNull();
	});

	test("loads suggestions for the selected context with the fixed limit", async () => {
		const suggestions = [suggestion("sug-1"), suggestion("sug-2")];
		const listEmergenceSuggestions = vi.fn(async () => suggestions);
		const controller = createEmergenceController(createPorts({ listEmergenceSuggestions }));

		await controller.load("item-a");

		expect(listEmergenceSuggestions).toHaveBeenCalledWith("item-a", LIMIT);
		expect(controller.suggestions).toEqual(suggestions);
		expect(controller.loading).toBe(false);
	});

	test("toggles loading while a load is in flight", async () => {
		const pending = deferred<EmergenceSuggestion[]>();
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn(() => pending.promise),
		}));

		const loading = controller.load("item-a");
		expect(controller.loading).toBe(true);

		pending.resolve([]);
		await loading;
		expect(controller.loading).toBe(false);
	});

	test("clears suggestions and invalidates an in-flight load", async () => {
		const first = deferred<EmergenceSuggestion[]>();
		const listEmergenceSuggestions = vi.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce([suggestion("sug-late")]);
		const controller = createEmergenceController(createPorts({ listEmergenceSuggestions }));

		const staleLoad = controller.load("item-a");
		controller.clear();
		expect(controller.suggestions).toEqual([]);
		expect(controller.loading).toBe(false);

		first.resolve([suggestion("sug-stale")]);
		await staleLoad;
		expect(controller.suggestions).toEqual([]);

		await controller.load("item-a");
		expect(controller.suggestions).toEqual([suggestion("sug-late")]);
	});

	test("ignores a stale load result when a newer load wins", async () => {
		const first = deferred<EmergenceSuggestion[]>();
		const second = deferred<EmergenceSuggestion[]>();
		const listEmergenceSuggestions = vi.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const controller = createEmergenceController(createPorts({ listEmergenceSuggestions }));

		const firstLoad = controller.load("item-a");
		const secondLoad = controller.load("item-a");
		second.resolve([suggestion("sug-2")]);
		await secondLoad;
		first.resolve([suggestion("sug-1")]);
		await firstLoad;

		expect(controller.suggestions).toEqual([suggestion("sug-2")]);
		expect(controller.loading).toBe(false);
	});

	test("ignores a load result for a stale selection", async () => {
		let selectedId = "item-a";
		const listEmergenceSuggestions = vi.fn(async () => [suggestion("sug-1")]);
		const controller = createEmergenceController({
			...createPorts({ listEmergenceSuggestions }),
			getSelectedId: () => selectedId,
		});

		const loading = controller.load("item-a");
		selectedId = "item-other";
		await loading;

		expect(controller.suggestions).toEqual([]);
	});

	test("notifies only pending, unseen suggestions as a toast", async () => {
		const suggestions = [
			suggestion("sug-1", { persistenceStatus: "accepted" }),
			suggestion("sug-2", { persistenceStatus: "pending" }),
			suggestion("sug-3", { persistenceStatus: "pending" }),
		];
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn(async () => suggestions),
		}));

		await controller.load("item-a");

		expect(controller.toast).toEqual({
			id: 1,
			title: "新しい関係候補",
			message: "title(item-b) ほか1件の候補が見つかりました。",
		});
	});

	test("reports a single pending suggestion with a singular toast", async () => {
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn(async () => [suggestion("sug-1")]),
		}));

		await controller.load("item-a");

		expect(controller.toast).toEqual({
			id: 1,
			title: "新しい関係候補",
			message: "title(item-b)との関係候補が見つかりました。",
		});
	});

	test("does not re-notify a suggestion seen in a previous load", async () => {
		const listEmergenceSuggestions = vi.fn()
			.mockResolvedValueOnce([suggestion("sug-1")])
			.mockResolvedValueOnce([
				suggestion("sug-1", { persistenceStatus: "accepted" }),
				suggestion("sug-2"),
			]);
		const controller = createEmergenceController(createPorts({ listEmergenceSuggestions }));

		await controller.load("item-a");
		await controller.load("item-a");

		expect(controller.toast).toEqual({
			id: 2,
			title: "新しい関係候補",
			message: "title(item-b)との関係候補が見つかりました。",
		});
	});

	test("dismisses the current toast", async () => {
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn(async () => [suggestion("sug-1")]),
		}));
		await controller.load("item-a");
		expect(controller.toast).not.toBeNull();

		controller.dismissToast();

		expect(controller.toast).toBeNull();
	});

	test("reports a load failure through the error port", async () => {
		const reportError = vi.fn();
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn(async () => {
				throw new Error("load failed");
			}),
		}, { reportError }));

		await controller.load("item-a");

		expect(reportError).toHaveBeenCalledTimes(1);
		expect(controller.loading).toBe(false);
	});

	test("keeps loading while a stale load settles before the newest load", async () => {
		const first = deferred<EmergenceSuggestion[]>();
		const second = deferred<EmergenceSuggestion[]>();
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		}));

		const staleLoad = controller.load("item-a");
		const newestLoad = controller.load("item-a");
		first.resolve([suggestion("sug-1")]);
		await staleLoad;
		expect(controller.loading).toBe(true);

		second.resolve([suggestion("sug-2")]);
		await newestLoad;
		expect(controller.loading).toBe(false);
	});

	test("does not report an error for a stale failed load", async () => {
		const first = deferred<EmergenceSuggestion[]>();
		const reportError = vi.fn();
		const controller = createEmergenceController(createPorts({
			listEmergenceSuggestions: vi.fn()
				.mockReturnValueOnce(first.promise)
				.mockResolvedValueOnce([]),
		}, { reportError }));

		const staleLoad = controller.load("item-a");
		await controller.load("item-a");
		first.reject(new Error("stale failure"));
		await staleLoad;

		expect(reportError).not.toHaveBeenCalled();
	});

	test("resolves a suggestion with the trimmed resolution reason", async () => {
		const resolveEmergenceSuggestion = vi.fn(async () => undefined);
		const controller = createEmergenceController(createPorts({ resolveEmergenceSuggestion }));

		controller.setResolutionReason("sug-1", "  同じ発想  ");
		await controller.resolve(suggestion("sug-1"), "accept");

		expect(resolveEmergenceSuggestion).toHaveBeenCalledWith("sug-1", "accept", "同じ発想");
		expect(controller.resolutionReasons).toEqual({});
	});

	test("resolves a suggestion without a reason as undefined", async () => {
		const resolveEmergenceSuggestion = vi.fn(async () => undefined);
		const controller = createEmergenceController(createPorts({ resolveEmergenceSuggestion }));

		await controller.resolve(suggestion("sug-1"), "dismiss");

		expect(resolveEmergenceSuggestion).toHaveBeenCalledWith("sug-1", "dismiss", undefined);
	});

	test("reloads the outline only when accepting a suggestion", async () => {
		const reloadOutline = vi.fn(async () => undefined);
		const controller = createEmergenceController(createPorts({}, { reloadOutline }));

		await controller.resolve(suggestion("sug-1"), "accept");
		expect(reloadOutline).toHaveBeenCalledTimes(1);

		await controller.resolve(suggestion("sug-2"), "dismiss");
		await controller.resolve(suggestion("sug-3"), "pin");
		expect(reloadOutline).toHaveBeenCalledTimes(1);
	});

	test("reloads the selected context after resolving", async () => {
		const listEmergenceSuggestions = vi.fn(async () => [suggestion("sug-1")]);
		const controller = createEmergenceController(createPorts({ listEmergenceSuggestions }));

		await controller.load("item-a");
		await controller.resolve(suggestion("sug-1"), "accept");

		expect(listEmergenceSuggestions).toHaveBeenCalledTimes(2);
		expect(listEmergenceSuggestions).toHaveBeenLastCalledWith("item-a", LIMIT);
	});

	test("clears when resolving without a selected context and skips the API", async () => {
		const listEmergenceSuggestions = vi.fn(async () => []);
		const controller = createEmergenceController({
			...createPorts({ listEmergenceSuggestions }),
			getSelectedId: () => null,
		});
		await controller.resolve(suggestion("sug-1"), "dismiss");

		expect(controller.suggestions).toEqual([]);
		expect(controller.loading).toBe(false);
		expect(listEmergenceSuggestions).not.toHaveBeenCalled();
	});

	test("reports a resolve failure and keeps the resolution reason", async () => {
		const reportError = vi.fn();
		const controller = createEmergenceController(createPorts({
			resolveEmergenceSuggestion: vi.fn(async () => {
				throw new Error("resolve failed");
			}),
		}, { reportError }));

		controller.setResolutionReason("sug-1", "メモ");
		await controller.resolve(suggestion("sug-1"), "pin");

		expect(reportError).toHaveBeenCalledTimes(1);
		expect(controller.resolutionReasons).toEqual({ "sug-1": "メモ" });
	});
});
