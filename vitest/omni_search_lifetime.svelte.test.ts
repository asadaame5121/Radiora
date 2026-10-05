import { afterEach, expect, it, vi } from "vitest";
import { createOmniSearchController } from "../src/ui/omni_search_controller.svelte.ts";
import { createCommandPaletteController } from "../src/ui/command_palette_controller.svelte.ts";
import type { SearchResult } from "../src/domain/models.ts";
afterEach(() => vi.useRealTimers());
function pending<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
it("drops reversed results and late errors after clear/dispose", async () => {
	vi.useFakeTimers();
	const first = pending<SearchResult[]>();
	const second = pending<SearchResult[]>();
	const error = vi.fn();
	const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
	const controller = createOmniSearchController({
		searchPort: {
			suggestItems: async () => [],
			searchItems: search,
			getSelectedId: () => null,
			reportError: error,
		},
	});
	controller.input("old");
	await vi.advanceTimersByTimeAsync(250);
	controller.input("new");
	await vi.advanceTimersByTimeAsync(250);
	second.resolve([]);
	await Promise.resolve();
	first.reject(new Error("old failure"));
	await Promise.resolve();
	expect(error).not.toHaveBeenCalled();
	const late = pending<SearchResult[]>();
	search.mockReturnValueOnce(late.promise);
	controller.input("late");
	await vi.advanceTimersByTimeAsync(250);
	controller.clearOmniwindow();
	controller.dispose();
	late.reject(new Error("disposed"));
	await Promise.resolve();
	controller.input("ignored");
	expect(controller.quickCaptureText).toBe("");
	expect(error).not.toHaveBeenCalled();
});
it("accepted operation clears only its input and Palette preserves Omni text", () => {
	const omni = createOmniSearchController({
		searchPort: {
			suggestItems: async () => [],
			searchItems: async () => [],
			getSelectedId: () => null,
			reportError: vi.fn(),
		},
	});
	vi.useFakeTimers();
	omni.input("original");
	const receipt = omni.captureInput();
	const palette = createCommandPaletteController();
	palette.openCommandPalette();
	palette.setQuery("command");
	palette.closeCommandPalette();
	expect(omni.quickCaptureText).toBe("original");
	omni.input("new draft");
	omni.clearAccepted(receipt);
	expect(omni.quickCaptureText).toBe("new draft");
	omni.clearAccepted(omni.captureInput());
	expect(omni.quickCaptureText).toBe("");
	omni.dispose();
});
