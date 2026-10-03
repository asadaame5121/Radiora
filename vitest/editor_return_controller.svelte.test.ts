import { afterEach, expect, test, vi } from "vitest";
import { EditorReturnController } from "../src/ui/editor_return_controller.svelte.ts";

afterEach(() => vi.unstubAllGlobals());

test("editor return passes remembered coordinates to the sole navigation boundary", async () => {
	vi.stubGlobal("CSS", { escape: (id: string) => id });
	vi.stubGlobal("document", {
		querySelector: (selector: string) =>
			selector.startsWith("textarea")
				? {
					selectionStart: 3,
					selectionEnd: 7,
					selectionDirection: "backward",
					scrollTop: 19,
					scrollLeft: 5,
				}
				: { scrollTop: 91 },
	});
	const navigate = vi.fn(async () => false);
	const controller = new EditorReturnController({
		navigation: { origin: 0, navigate },
		hasItem: () => true,
	});
	controller.remember("original", "root");
	await controller.restore();
	expect(navigate).toHaveBeenCalledWith({
		view: "outline",
		occurrenceId: "original",
		hoistId: "root",
		longForm: false,
		editorPosition: {
			itemId: "original",
			hoistId: "root",
			start: 3,
			end: 7,
			direction: "backward",
			scrollTop: 19,
			scrollLeft: 5,
			panelScrollTop: 91,
		},
	});
});
