import { afterEach, expect, test, vi } from "vitest";
import { KeyboardWorkspaceController } from "../src/ui/keyboard_workspace_controller.svelte.ts";
import { navigationFixture } from "./navigation_fixture.ts";

afterEach(() => vi.unstubAllGlobals());

test("Outline shortcut uses suspended Outline instead of the Tree selection", async () => {
	const f = navigationFixture();
	vi.stubGlobal("CSS", { escape: (id: string) => id });
	vi.stubGlobal("document", { querySelector: vi.fn(() => null) });
	const keyboard = new KeyboardWorkspaceController({
		selectedId: f.selected,
		hoistId: () => f.location().hoistOccurrenceId,
		view: () => f.navigation.view,
		navigation: f.navigation,
		longFormActive: () => false,
		leaveLongForm: vi.fn(),
		startLongForm: vi.fn(),
		select: vi.fn(),
		focus: vi.fn(),
		setHoist: vi.fn(),
		reveal: vi.fn(),
		projection: vi.fn(),
		items: () => f.snapshot().items,
		clearTemporaryExpansion: vi.fn(),
		setCollapsed: vi.fn(),
		reload: vi.fn(),
	});
	await keyboard.openTree();
	f.selectAway();
	await keyboard.openOutline();
	expect(f.selected()).toBe("source");
	expect(f.location().hoistOccurrenceId).toBe("source");
});
