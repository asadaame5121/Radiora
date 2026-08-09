import { describe, expect, test, vi } from "vitest";
import type { UpdateCheckResult } from "../src/services/update_checker.ts";
import { createHelpUpdateController } from "../src/ui/help_update_controller.svelte.ts";

describe("help update controller", () => {
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
			checkForUpdate: vi.fn(async () => updateResult({ latest: null, error: "offline" })),
		});

		await expect(controller.check()).resolves.toBeUndefined();
		expect(controller.status).toBe("unavailable");
		expect(controller.latest).toBeNull();
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
