import { afterEach, expect, test, vi } from "vitest";
import { focusTreeSelection } from "../src/ui/tree_focus_adapter.ts";

afterEach(() => vi.unstubAllGlobals());

test("tree focus prioritizes the selected node and falls back when none is selected", () => {
	const selected = { focus: vi.fn() };
	const first = { focus: vi.fn() };
	const query = vi.fn((selector: string) => selector === ".tree-node.selected" ? selected : first);
	vi.stubGlobal("document", { querySelector: query });
	focusTreeSelection();
	expect(selected.focus).toHaveBeenCalledOnce();
	expect(first.focus).not.toHaveBeenCalled();
	query.mockImplementation((selector) => selector === ".tree-node.selected" ? null : first);
	focusTreeSelection();
	expect(first.focus).toHaveBeenCalledOnce();
	query.mockReturnValue(null);
	expect(() => focusTreeSelection()).not.toThrow();
});

test("empty or filtered Tree falls back to the focusable SVG root", () => {
	const root = { focus: vi.fn() };
	vi.stubGlobal("document", {
		querySelector: vi.fn((selector: string) => selector === ".tree-root svg" ? root : null),
	});
	focusTreeSelection();
	expect(root.focus).toHaveBeenCalledOnce();
});
