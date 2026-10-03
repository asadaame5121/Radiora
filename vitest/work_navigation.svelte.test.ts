import { expect, test, vi } from "vitest";
import { createWorkController, type WorkApiPort } from "../src/ui/work_controller.svelte.ts";
import { navigationFixture } from "./navigation_fixture.ts";

for (const operation of ["place", "root"] as const) {
	for (const choice of ["save", "discard", "cancel"] as const) {
		test(`${operation} passes a destination to navigation and waits for ${choice}`, async () => {
			const f = navigationFixture();
			await f.navigation.navigate({ view: "unplaced" });
			f.dirty();
			const api = {
				createItem: vi.fn(async () => f.created),
				placeUnplacedWork: vi.fn(async () => f.created),
				listUnplacedWorks: vi.fn(async () => []),
			} as unknown as WorkApiPort;
			const reload = vi.fn(async () => true);
			const controller = createWorkController({
				api,
				navigation: f.navigation,
				getSnapshot: f.snapshot,
				reload,
				selectOccurrence: vi.fn(),
				requestConfirmation: vi.fn(),
				reportError: f.reportError,
			});
			const pending = operation === "place"
				? controller.placeUnplaced("work-created", null)
				: controller.performQuickCapture("created", "root");
			await vi.waitFor(() => expect(f.guard.pending).not.toBeNull());
			expect(f.selected()).toBe("source");
			expect(f.guard.item?.id).toBe("source");
			expect(f.navigation.view).toBe("unplaced");
			await f.guard.resolvePending(choice);
			await pending;
			expect(f.selected()).toBe(choice === "cancel" ? "source" : "created");
			expect(f.navigation.view).toBe(choice === "cancel" ? "unplaced" : "outline");
			expect(reload).toHaveBeenCalledWith();
		});
	}
	test(`${operation} does not navigate after a domain operation outlives its origin`, async () => {
		const f = navigationFixture();
		let finish!: (item: typeof f.created) => void;
		const result = new Promise<typeof f.created>((resolve) => finish = resolve);
		const api = {
			createItem: vi.fn(() => result),
			placeUnplacedWork: vi.fn(() => result),
			listUnplacedWorks: vi.fn(async () => []),
		} as unknown as WorkApiPort;
		const controller = createWorkController({
			api,
			navigation: f.navigation,
			getSnapshot: f.snapshot,
			reload: vi.fn(async () => true),
			selectOccurrence: vi.fn(),
			requestConfirmation: vi.fn(),
			reportError: f.reportError,
		});
		const pending = operation === "place"
			? controller.placeUnplaced("work-created", null)
			: controller.performQuickCapture("created", "root");
		await f.navigation.navigate({ view: "help" });
		finish(f.created);
		await pending;
		expect(f.navigation.view).toBe("help");
		expect(f.selected()).toBe("source");
	});
}
