import { describe, expect, test, vi } from "vitest";
import type { UpdateCheckResult } from "../src/services/update_checker.ts";
import { createHelpUpdateController } from "../src/ui/help_update_controller.svelte.ts";

describe("help update controller", () => {
	test("starts idle with the configured version", () => {
		const controller = createHelpUpdateController({ currentVersion: "0.3.0" });

		expect(controller.currentVersion).toBe("0.3.0");
		expect(controller.status).toBe("idle");
		expect(controller.latest).toBeNull();
	});

	test("reports an available update with current and latest release data", async () => {
		const result = updateResult({ updateAvailable: true });
		const checkForUpdate = vi.fn(async () => result);
		const controller = createHelpUpdateController({ currentVersion: "0.3.0", checkForUpdate });

		await controller.check();

		expect(checkForUpdate).toHaveBeenCalledWith("0.3.0");
		expect(controller.status).toBe("available");
		expect(controller.latest).toEqual(result.latest);
	});

	test("keeps failed checks in a quiet unavailable state", async () => {
		const controller = createHelpUpdateController({
			checkForUpdate: vi.fn(async () => updateResult({ error: "offline" })),
		});

		await expect(controller.check()).resolves.toBeUndefined();
		expect(controller.status).toBe("unavailable");
		expect(controller.latest?.version).toBe("0.4.0");
	});

	test("ignores a rejected stale check", async () => {
		const first = deferred<UpdateCheckResult>();
		const controller = createHelpUpdateController({
			checkForUpdate: vi.fn()
				.mockReturnValueOnce(first.promise)
				.mockResolvedValueOnce(updateResult({ updateAvailable: false })),
		});

		const staleCheck = controller.check();
		await controller.check();
		first.reject(new Error("stale failure"));
		await expect(staleCheck).resolves.toBeUndefined();

		expect(controller.status).toBe("current");
	});

	test.each(
		[
			{ updateAvailable: false, expected: "current" },
			{ updateAvailable: true, expected: "available" },
		] as const,
	)("maps a successful release check to $expected", async ({ updateAvailable, expected }) => {
		const controller = createHelpUpdateController({
			checkForUpdate: vi.fn(async () => updateResult({ updateAvailable })),
		});

		const checking = controller.check();
		expect(controller.status).toBe("checking");
		expect(controller.latest).toBeNull();
		await checking;

		expect(controller.status).toBe(expected);
	});

	test("converts a rejected check to unavailable", async () => {
		const controller = createHelpUpdateController({
			checkForUpdate: vi.fn(async () => {
				throw new Error("offline");
			}),
		});

		await expect(controller.check()).resolves.toBeUndefined();
		expect(controller.status).toBe("unavailable");
		expect(controller.latest).toBeNull();
	});

	test("keeps only the newest overlapping result", async () => {
		const first = deferred<UpdateCheckResult>();
		const second = deferred<UpdateCheckResult>();
		const checkForUpdate = vi.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const controller = createHelpUpdateController({ checkForUpdate });

		const firstCheck = controller.check();
		const secondCheck = controller.check();
		second.resolve(updateResult({ updateAvailable: false }));
		await secondCheck;
		first.resolve(updateResult({ updateAvailable: true }));
		await firstCheck;

		expect(controller.status).toBe("current");
	});

	test("ignores a result after the help view is disposed", async () => {
		let resolve!: (result: UpdateCheckResult) => void;
		const pending = new Promise<UpdateCheckResult>((next) => resolve = next);
		const controller = createHelpUpdateController({ checkForUpdate: () => pending });

		const checking = controller.check();
		controller.dispose();
		resolve(updateResult({ updateAvailable: true }));
		await checking;

		expect(controller.status).toBe("checking");
		expect(controller.latest).toBeNull();
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function updateResult(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
	return {
		currentVersion: "0.3.0",
		latest: {
			tagName: "v0.4.0",
			version: "0.4.0",
			url: "https://github.com/asadaame5121/Radiora/releases/tag/v0.4.0",
			publishedAt: null,
		},
		updateAvailable: false,
		error: null,
		...overrides,
	};
}
