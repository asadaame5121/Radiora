import { afterEach, expect, test, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";
import { KeyboardWorkspaceController } from "../src/ui/keyboard_workspace_controller.svelte.ts";
import { ScreenNavigationController } from "../src/ui/screen_navigation_controller.svelte.ts";
import type { ViewMode } from "../src/ui/app_view_mode.ts";

afterEach(() => vi.unstubAllGlobals());

function setup() {
	vi.stubGlobal("document", { querySelector: () => null });
	vi.stubGlobal("CSS", { escape: (id: string) => id });
	const items = ["editor", "tree"].map((id) => ({ id, workId: id }) as OutlineItem);
	let selectedId = "editor";
	let hoistId: string | null = "editor-root";
	const navigation = new ScreenNavigationController({
		capture: () => ({ selectedId, hoistId }),
		restore: async (context: { selectedId: string; hoistId: string | null }) => {
			({ selectedId, hoistId } = context);
			return true;
		},
	});
	const guard = new HistoricalTimeController({
		save: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn().mockResolvedValue(true),
		select: vi.fn(),
	});
	guard.select(items[0]);
	const commitSelection = (id: string) => {
		selectedId = id;
	};
	const ports = {
		selectedId: () => selectedId,
		hoistId: () => hoistId,
		view: () => navigation.view,
		prepareView: (view: ViewMode) => navigation.prepareOpen(view),
		longFormActive: () => false,
		leaveLongForm: vi.fn(async () => true),
		startLongForm: vi.fn().mockResolvedValue(undefined),
		select: (id: string) => {
			const commit = () => commitSelection(id);
			if (!guard.select(items.find((item) => item.id === id) ?? null, commit)) return false;
			commit();
			return true;
		},
		selectWhenReady: (id: string) =>
			guard.selectWhenReady(
				items.find((item) => item.id === id) ?? null,
				() => commitSelection(id),
			),
		setHoist: (id: string | null) => {
			hoistId = id;
		},
		reveal: vi.fn(),
		projection: vi.fn(),
		items: () => items,
		clearTemporaryExpansion: vi.fn(),
		setCollapsed: vi.fn(),
		reload: vi.fn(),
	};
	const workspace = new KeyboardWorkspaceController(ports);
	workspace.remember();
	navigation.open("globalLineage");
	ports.select("tree");
	hoistId = null;
	return { workspace, navigation, guard, ports, state: () => ({ selectedId, hoistId }) };
}

test("Return to Editor captures the Tree caller before restoring the editor selection and hoist", async () => {
	const { workspace, navigation, state } = setup();
	await workspace.returnToEditor();
	expect(navigation.view).toBe("outline");
	expect(state()).toEqual({ selectedId: "editor", hoistId: "editor-root" });
	await navigation.goBack();
	expect(navigation.view).toBe("globalLineage");
	expect(state()).toEqual({ selectedId: "tree", hoistId: null });
});

test.each(["cancel", "discard", "save"] as const)(
	"Return to Editor waits for accepted selection before changing the hoist, view, or history: %s",
	async (choice) => {
		const { workspace, navigation, guard, ports, state } = setup();
		guard.draft.start.unknown = false;
		guard.draft.start.year = "2026";
		const restore = workspace.returnToEditor();
		await vi.waitFor(() => expect(guard.pending?.item?.id).toBe("editor"));
		expect(navigation.view).toBe("globalLineage");
		expect(state()).toEqual({ selectedId: "tree", hoistId: null });
		expect(ports.reveal).not.toHaveBeenCalled();
		await guard.resolvePending(choice);
		await restore;
		if (choice !== "cancel") {
			expect(navigation.view).toBe("outline");
			expect(state()).toEqual({ selectedId: "editor", hoistId: "editor-root" });
			await navigation.goBack();
		}
		expect(navigation.view).toBe("globalLineage");
		expect(state()).toEqual({ selectedId: "tree", hoistId: null });
		await navigation.goBack();
		expect(navigation.view).toBe("outline");
		expect(navigation.canGoBack).toBe(false);
	},
);

test.each(["openOutline", "openTree", "openLongForm", "saveLongForm"] as const)(
	"%s captures the caller before manuscript persistence changes the selection",
	async (operation) => {
		const { workspace, navigation, ports, state } = setup();
		navigation.open("today");
		ports.leaveLongForm.mockImplementation(async () => ports.select("editor"));
		ports.startLongForm.mockImplementation(async () => {
			ports.select("editor");
		});
		await workspace[operation]();
		await navigation.goBack();
		expect(navigation.view).toBe("today");
		expect(state()).toEqual({ selectedId: "tree", hoistId: null });
	},
);
