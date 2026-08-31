import { describe, expect, test, vi } from "vitest";
import { createThemeController } from "../src/ui/theme_controller.svelte.ts";
import type { ThemePreferenceStorage } from "../src/ui/theme_preference.ts";

function memoryStorage(
	initialValue?: string,
): ThemePreferenceStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	if (initialValue) {
		values.set("radiora.themePreference", initialValue);
	}
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

describe("theme controller", () => {
	test("defaults to auto preference and reads stored preference", () => {
		const emptyStorage = memoryStorage();
		const controller1 = createThemeController({ storage: emptyStorage });
		expect(controller1.preference).toBe("auto");

		const darkStorage = memoryStorage("dark");
		const controller2 = createThemeController({ storage: darkStorage });
		expect(controller2.preference).toBe("dark");

		const lightStorage = memoryStorage("light");
		const controller3 = createThemeController({ storage: lightStorage });
		expect(controller3.preference).toBe("light");
	});

	test("setPreference updates preference and persists value", () => {
		const storage = memoryStorage();
		const controller = createThemeController({ storage });

		controller.setPreference("light");
		expect(controller.preference).toBe("light");
		expect(storage.getItem("radiora.themePreference")).toBe("light");

		controller.setPreference("dark");
		expect(controller.preference).toBe("dark");
		expect(storage.getItem("radiora.themePreference")).toBe("dark");

		controller.setPreference("auto");
		expect(controller.preference).toBe("auto");
		expect(storage.getItem("radiora.themePreference")).toBe("auto");
	});

	test("init applies initial theme and unsubscribes on cleanup", () => {
		const storage = memoryStorage("light");
		const applyTheme = vi.fn();
		const listenSystemChange = vi.fn(() => vi.fn());

		const controller = createThemeController({
			storage,
			applyTheme,
			listenSystemChange,
		});

		const cleanup = controller.init();
		expect(applyTheme).toHaveBeenCalledWith("light");
		expect(listenSystemChange).toHaveBeenCalled();

		cleanup();
	});

	test("resolvedTheme resolves auto preference against system setting", () => {
		const controller = createThemeController({
			storage: memoryStorage("auto"),
			getSystemPrefersDark: () => true,
		});
		expect(controller.resolvedTheme).toBe("dark");

		const lightController = createThemeController({
			storage: memoryStorage("auto"),
			getSystemPrefersDark: () => false,
		});
		expect(lightController.resolvedTheme).toBe("light");

		lightController.setPreference("dark");
		expect(lightController.resolvedTheme).toBe("dark");

		lightController.setPreference("light");
		expect(lightController.resolvedTheme).toBe("light");
	});
});
