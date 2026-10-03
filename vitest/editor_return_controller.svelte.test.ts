import { afterEach, expect, test, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import { EditorReturnController } from "../src/ui/editor_return_controller.svelte.ts";

afterEach(() => vi.unstubAllGlobals());

test("return restores occurrence, hoist, selection and scroll only after saving succeeds", async () => {
	const textarea = {
		selectionStart: 3,
		selectionEnd: 7,
		scrollTop: 19,
		scrollLeft: 5,
		setSelectionRange: vi.fn(),
	};
	const panel = { scrollTop: 91 };
	const host = { dispatchEvent: vi.fn() };
	vi.stubGlobal("CSS", { escape: (id: string) => id });
	vi.stubGlobal("document", {
		querySelector: (selector: string) => {
			if (selector.startsWith("textarea")) return textarea;
			if (selector.startsWith(".markdown-editor-host")) return host;
			if (selector === ".outline-panel") return panel;
			return null;
		},
	});
	const sequence: string[] = [];
	let selectedId = "original";
	const ports = {
		selectedId: () => selectedId,
		hoistId: () => "root",
		view: () => "outline" as const,
		setView: vi.fn(() => sequence.push("view")),
		longFormActive: () => false,
		leaveLongForm: vi.fn(async () => {
			sequence.push("save");
			return false;
		}),
		startLongForm: vi.fn(),
		select: vi.fn((id: string) => {
			selectedId = id;
			sequence.push(`select:${id}`);
			return true;
		}),
		setHoist: vi.fn(() => {
			selectedId = "root";
			sequence.push("hoist");
		}),
		reveal: vi.fn(() => sequence.push("reveal")),
		items: () => [{ id: "original" }] as OutlineItem[],
		projection: vi.fn(),
		clearTemporaryExpansion: vi.fn(),
		setCollapsed: vi.fn(),
		reload: vi.fn(),
	};
	const controller = new EditorReturnController({
		beforeRestore: ports.leaveLongForm,
		hasItem: (id) => ports.items().some((item) => item.id === id),
		select: async (id) => ports.select(id),
		setHoist: ports.setHoist,
		reveal: ports.reveal,
		prepareEditor: () => ports.setView,
	});
	controller.remember("original", "root");
	selectedId = "different";
	textarea.scrollTop = 0;
	textarea.scrollLeft = 0;
	panel.scrollTop = 0;
	await controller.restore();
	expect(sequence).toEqual(["save"]);
	expect(selectedId).toBe("different");
	sequence.length = 0;
	ports.leaveLongForm.mockImplementation(async () => {
		sequence.push("save");
		return true;
	});
	await controller.restore();
	expect(sequence).toEqual([
		"save",
		"select:original",
		"hoist",
		"select:original",
		"reveal",
		"view",
	]);
	expect(ports.setHoist).toHaveBeenCalledWith("root");
	expect(selectedId).toBe("original");
	expect(textarea.setSelectionRange).toHaveBeenCalledWith(3, 7);
	expect([textarea.scrollTop, textarea.scrollLeft, panel.scrollTop]).toEqual([19, 5, 91]);
	expect(host.dispatchEvent).toHaveBeenCalledWith(
		expect.objectContaining({ type: "radiora:focus-editor", detail: { caretOffset: 3 } }),
	);
});
