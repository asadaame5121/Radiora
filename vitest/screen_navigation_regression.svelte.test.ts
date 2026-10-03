import { describe, expect, it, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import { createNavigationHarness } from "./screen_navigation_harness.ts";

vi.mock("svelte", () => ({ tick: async () => undefined }));

function resolveHarnessTask(
	task: { kind: string; settled: boolean; resolve(val: unknown): void },
	getSnapshot: () => unknown,
): void {
	if (task.settled) return;
	if (task.kind === "longform_reload") task.resolve(true);
	else if (task.kind === "read_outline") task.resolve(getSnapshot());
	else if (task.kind === "screen_prepare") task.resolve(() => undefined);
	else task.resolve(undefined);
}

async function drainUntilSettled<T>(
	promise: Promise<T>,
	harness: ReturnType<typeof createNavigationHarness>,
): Promise<T> {
	let settled = false;
	let result: T | undefined;
	let error: unknown;
	promise.then(
		(val) => {
			settled = true;
			result = val;
		},
		(err) => {
			settled = true;
			error = err;
		},
	);
	while (!settled) {
		const tasks = [...harness.registry.pendingTasks];
		for (const t of tasks) {
			resolveHarnessTask(t, () => harness.state.getSnapshot());
		}
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
	}
	if (error) throw error;
	if (result === undefined) throw new Error("Promise settled without value");
	return result;
}

describe("Deterministic regressions discovered through PBT and review audit", () => {
	it("Bug 1 (P1): Preserves manuscript edits entered while navigation save is in-flight", async () => {
		const harness = createNavigationHarness();
		const item = harness.store.items.get("root-1");
		if (!item) throw new Error("root-1 not found");

		// Setup manuscript mode with text A
		harness.longForm.setMode(true, item);
		harness.longForm.input("text A");
		expect(harness.longForm.state.dirty).toBe(true);

		// Start navigating to help (starts editor.save(false))
		const navPromise = harness.workspace.navigate({ view: "help" });

		// Wait for longform_save task to appear
		await vi.waitFor(() =>
			expect(harness.registry.pendingTasks.some((t) => t.kind === "longform_save")).toBe(true)
		);
		const saveTask = harness.registry.pendingTasks.find((t) => t.kind === "longform_save");
		if (!saveTask) throw new Error("saveTask not found");

		// User types text B while save is pending
		harness.longForm.input("text B");
		expect(harness.longForm.state.text).toBe("text B");

		// Resolve first save task
		saveTask.resolve(undefined);

		// Drain remaining tasks until help navigation settles
		await drainUntilSettled(navPromise, harness);
		expect(harness.workspace.view).toBe("help");

		// Navigate back to Outline
		await drainUntilSettled(harness.workspace.goBack(), harness);
		expect(harness.workspace.view).toBe("outline");

		// Text B MUST be preserved and stored in persistence
		expect(harness.store.items.get("root-1")?.text).toBe("text B");
		expect(harness.longForm.state.text).toBe("text B");
	});

	it("Bug 2: Saves pending edits before navigating to another occurrence within outline", async () => {
		// Counterexample seed: 1759562598, path: "2:2:0:0:1:2:2:2:2:1:1"
		const harness = createNavigationHarness();
		const rootItem = harness.store.items.get("root-1");
		if (!rootItem) throw new Error("root-1 not found");

		harness.longForm.setMode(true, rootItem);
		harness.longForm.input("edited text before moving");
		expect(harness.longForm.state.dirty).toBe(true);

		// Navigate to child-1 within the same outline
		const navPromise = harness.workspace.navigate({ view: "outline", occurrenceId: "child-1" });
		await drainUntilSettled(navPromise, harness);

		// The edit on root-1 must have been persisted, NOT dropped on occurrence switch
		expect(harness.store.items.get("root-1")?.text).toBe("edited text before moving");
	});

	it("Bug 3: A newer cancelled request invalidates older in-flight request", async () => {
		const harness = createNavigationHarness();

		// Start a slow navigation to help
		const helpPromise = harness.workspace.navigate({ view: "help" });

		// While help is preparing, user changes historical time form to dirty and navigates to comparison
		harness.historicalTime.draft.start.year = "2026";
		harness.historicalTime.draft.start.unknown = false;
		expect(harness.historicalTime.dirty).toBe(true);

		const otherPromise = harness.workspace.navigate({
			view: "outline",
			occurrenceId: "other-2",
		});

		// User cancels the guard dialog
		await vi.waitFor(() => expect(harness.historicalTime.pending).not.toBeNull());
		harness.historicalTime.cancelPending();

		const [otherResult, helpResult] = await Promise.all([
			drainUntilSettled(otherPromise, harness),
			drainUntilSettled(helpPromise, harness),
		]);

		expect(otherResult).toBe(false);
		expect(helpResult).toBe(false);
		// Remained on outline, neither destination was committed
		expect(harness.workspace.view).toBe("outline");
	});

	it("Bug 4: Domain item created and placed remains persisted even if automatic navigation is superseded", async () => {
		const harness = createNavigationHarness();

		const newId = "created-item";
		const newItem: OutlineItem = {
			id: newId,
			workId: "work-new",
			text: "New Item",
			parentId: null,
			orderKey: 50,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b-new" },
			createdAt: "2026-10-03T00:00:00Z",
			updatedAt: "2026-10-03T00:00:00Z",
		};
		harness.store.items.set(newId, newItem);

		const origin = harness.workspace.origin;
		// Start auto navigation
		const autoNav = harness.workspace.navigate({ view: "outline", occurrenceId: newId }, origin);

		// User immediately requests help navigation, superseding auto navigation
		const helpNav = harness.workspace.navigate({ view: "help" });

		await Promise.all([
			drainUntilSettled(autoNav, harness),
			drainUntilSettled(helpNav, harness),
		]);

		// Navigation moved to help
		expect(harness.workspace.view).toBe("help");
		// But the created item MUST remain in the store
		expect(harness.store.items.get(newId)).toBeDefined();
		expect(harness.store.items.get(newId)?.text).toBe("New Item");
	});
});
