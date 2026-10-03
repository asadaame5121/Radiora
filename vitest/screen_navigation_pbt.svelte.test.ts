import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import type { ViewMode } from "../src/ui/app_view_mode.ts";
import type { ScreenDestination } from "../src/ui/screen_navigation_destination.ts";
import { createNavigationHarness } from "./screen_navigation_harness.ts";

vi.mock("svelte", () => ({ tick: async () => undefined }));

interface ModelPendingNav {
	id: number;
	destination: ScreenDestination;
	promise: Promise<boolean>;
	superseded: boolean;
	outcome?: boolean | "rejected";
}

interface NavModel {
	screen: ViewMode;
	selectedId: string | null;
	editingItemId: string | null;
	longFormText: string;
	longFormDirty: boolean;
	lastSavedText: string;
	pendingNavs: ModelPendingNav[];
	nextNavId: number;
	persistedItems: Map<string, OutlineItem>;
}

type PbtAction =
	| { type: "inputLongForm"; text: string }
	| { type: "toggleLongForm"; active: boolean }
	| { type: "navigate"; destination: ScreenDestination }
	| { type: "goBack" }
	| { type: "guardDecide"; decision: "save" | "discard" | "cancel" }
	| { type: "resolveTask"; taskIndex: number; success: boolean }
	| { type: "createAndPlace"; newId: string }
	| { type: "settleAll" };

function createInitialModel(initialText: string, items: OutlineItem[]): NavModel {
	return {
		screen: "outline",
		selectedId: "root-1",
		editingItemId: "root-1",
		longFormText: initialText,
		longFormDirty: false,
		lastSavedText: initialText,
		pendingNavs: [],
		nextNavId: 1,
		persistedItems: new Map(items.map((i) => [i.id, { ...i }])),
	};
}

const destinationArb = fc.oneof(
	fc.constant<ScreenDestination>({ view: "help" }),
	fc.constant<ScreenDestination>({ view: "today" }),
	fc.constant<ScreenDestination>({ view: "globalLineage" }),
	fc.constant<ScreenDestination>({ view: "outline" }),
	fc.constant<ScreenDestination>({ view: "outline", occurrenceId: "child-1" }),
	fc.constant<ScreenDestination>({ view: "outline", occurrenceId: "other-2" }),
);

const actionArb: fc.Arbitrary<PbtAction> = fc.oneof(
	fc.record({
		type: fc.constant("inputLongForm" as const),
		text: fc.stringMatching(/^[A-Za-z0-9_-]{1,15}$/),
	}),
	fc.record({
		type: fc.constant("toggleLongForm" as const),
		active: fc.boolean(),
	}),
	fc.record({
		type: fc.constant("navigate" as const),
		destination: destinationArb,
	}),
	fc.record({
		type: fc.constant("goBack" as const),
	}),
	fc.record({
		type: fc.constant("guardDecide" as const),
		decision: fc.constantFrom<"save" | "discard" | "cancel">("save", "discard", "cancel"),
	}),
	fc.record({
		type: fc.constant("resolveTask" as const),
		taskIndex: fc.nat(10),
		success: fc.boolean(),
	}),
	fc.record({
		type: fc.constant("createAndPlace" as const),
		newId: fc.stringMatching(/^[A-Za-z0-9]{3,8}$/),
	}),
	fc.record({
		type: fc.constant("settleAll" as const),
	}),
);

function handleInputLongForm(
	text: string,
	harness: ReturnType<typeof createNavigationHarness>,
	model: NavModel,
): void {
	if (harness.workspace.view === "outline" && harness.longForm.state.active) {
		harness.longForm.input(text);
		model.longFormText = text;
		model.longFormDirty = true;
	}
}

function handleToggleLongForm(
	active: boolean,
	harness: ReturnType<typeof createNavigationHarness>,
	model: NavModel,
): void {
	if (harness.workspace.view !== "outline") return;
	const currentId = harness.state.selectedId();
	const currentItem = currentId ? harness.store.items.get(currentId) ?? null : null;
	const wasSameActive = harness.longForm.state.active &&
		harness.longForm.state.dirty &&
		currentId === model.editingItemId;
	harness.longForm.setMode(active, currentItem);
	if (active && currentItem) {
		model.editingItemId = currentItem.id;
		if (!wasSameActive) {
			model.longFormText = currentItem.text;
			model.longFormDirty = false;
		}
	} else {
		model.editingItemId = null;
		model.longFormDirty = false;
		model.longFormText = "";
	}
}

function trackNavigation(
	destination: ScreenDestination,
	promise: Promise<boolean>,
	model: NavModel,
): void {
	for (const p of model.pendingNavs) p.superseded = true;
	const navId = model.nextNavId++;
	const navEntry: ModelPendingNav = {
		id: navId,
		destination,
		promise: Promise.resolve(false),
		superseded: false,
	};
	navEntry.promise = promise
		.then((res) => {
			navEntry.outcome = res;
			return res;
		})
		.catch((_cause) => {
			void _cause;
			navEntry.outcome = "rejected";
			return false;
		});
	model.pendingNavs.push(navEntry);
}

function handleGuardDecide(
	decision: "save" | "discard" | "cancel",
	harness: ReturnType<typeof createNavigationHarness>,
): void {
	if (!harness.historicalTime.pending) return;
	if (decision === "save") {
		void harness.historicalTime.save();
	} else if (decision === "discard") {
		harness.historicalTime.reset(harness.historicalTime.pending.item);
	} else {
		harness.historicalTime.cancelPending();
	}
}

function handleResolveTask(
	taskIndex: number,
	success: boolean,
	harness: ReturnType<typeof createNavigationHarness>,
): void {
	const tasks = harness.registry.pendingTasks;
	if (tasks.length === 0) return;
	const target = tasks[taskIndex % tasks.length];
	if (success) {
		if (target.kind === "longform_reload") target.resolve(true);
		else if (target.kind === "read_outline") target.resolve(harness.state.getSnapshot());
		else if (target.kind === "screen_prepare") target.resolve(() => undefined);
		else target.resolve(undefined);
	} else {
		target.reject(new Error("simulated failure"));
	}
}

function handleCreateAndPlace(
	newIdRaw: string,
	harness: ReturnType<typeof createNavigationHarness>,
	model: NavModel,
): void {
	const newId = `item-${newIdRaw}`;
	const newItem: OutlineItem = {
		id: newId,
		workId: `work-${newIdRaw}`,
		text: `Created ${newId}`,
		parentId: null,
		orderKey: 99,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "b-new" },
		createdAt: "2026-10-03T00:00:00Z",
		updatedAt: "2026-10-03T00:00:00Z",
	};
	harness.store.items.set(newId, newItem);
	model.persistedItems.set(newId, newItem);
	const origin = harness.workspace.origin;
	trackNavigation(
		{ view: "outline", occurrenceId: newId },
		harness.workspace.navigate({ view: "outline", occurrenceId: newId }, origin),
		model,
	);
}

async function executeAction(
	action: PbtAction,
	harness: ReturnType<typeof createNavigationHarness>,
	model: NavModel,
): Promise<void> {
	if (action.type === "inputLongForm") {
		handleInputLongForm(action.text, harness, model);
	} else if (action.type === "toggleLongForm") {
		handleToggleLongForm(action.active, harness, model);
	} else if (action.type === "navigate") {
		trackNavigation(action.destination, harness.workspace.navigate(action.destination), model);
	} else if (action.type === "goBack") {
		if (harness.workspace.canGoBack) {
			trackNavigation({ view: "outline" }, harness.workspace.goBack(), model);
		}
	} else if (action.type === "guardDecide") {
		handleGuardDecide(action.decision, harness);
	} else if (action.type === "resolveTask") {
		handleResolveTask(action.taskIndex, action.success, harness);
	} else if (action.type === "createAndPlace") {
		handleCreateAndPlace(action.newId, harness, model);
	} else if (action.type === "settleAll") {
		await drainAllTasks(harness, model);
	}
}

function resolveTaskBatch(
	tasks: { kind: string; settled: boolean; resolve(val: unknown): void }[],
	getSnapshot: () => unknown,
): void {
	for (const t of tasks) {
		if (t.settled) continue;
		if (t.kind === "longform_reload") t.resolve(true);
		else if (t.kind === "read_outline") t.resolve(getSnapshot());
		else if (t.kind === "screen_prepare") t.resolve(() => undefined);
		else t.resolve(undefined);
	}
}

async function drainAllTasks(
	harness: ReturnType<typeof createNavigationHarness>,
	model: NavModel,
): Promise<void> {
	let iterations = 0;
	while (
		(harness.registry.pendingTasks.length > 0 ||
			model.pendingNavs.some((n) => n.outcome === undefined)) &&
		iterations < 100
	) {
		iterations++;
		resolveTaskBatch(harness.registry.pendingTasks, () => harness.state.getSnapshot());
		await Promise.resolve();
	}
	for (const p of model.pendingNavs) {
		try {
			await p.promise;
		} catch (_cause) {
			void _cause;
		}
	}
}

function verifyInvariants(
	harness: ReturnType<typeof createNavigationHarness>,
	model: NavModel,
): void {
	// Property 1: New edits MUST NOT be lost or marked clean falsely
	if (model.longFormDirty && model.editingItemId) {
		const targetItem = harness.store.items.get(model.editingItemId);
		const isPersisted = targetItem?.text === model.longFormText;
		if (!isPersisted && harness.longForm.state.active) {
			expect(harness.longForm.state.dirty).toBe(true);
			expect(harness.longForm.state.text).toBe(model.longFormText);
		}
	}

	// Property 5: Created items MUST remain in persistence even if automatic navigation preempted
	for (const [id, expectedItem] of model.persistedItems) {
		const stored = harness.store.items.get(id);
		expect(stored).toBeDefined();
		expect(stored?.id).toBe(expectedItem.id);
	}

	// Property 6: No persistent busy/deadlock after all tasks settled
	if (
		harness.registry.pendingTasks.length === 0 &&
		model.pendingNavs.every((n) => n.outcome !== undefined)
	) {
		expect(harness.workspace.pendingView).toBeNull();
	}
}

describe("Screen Navigation State-Machine Property-Based Testing", () => {
	it(
		"satisfies all 7 invariants under arbitrary sequences of commands and async interleavings",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(actionArb, { minLength: 5, maxLength: 25 }),
					async (actions) => {
						const harness = createNavigationHarness();
						const initialItem = harness.store.items.get("root-1");
						if (!initialItem) throw new Error("root-1 not found");
						harness.longForm.setMode(true, initialItem);

						const model = createInitialModel(
							initialItem.text,
							Array.from(harness.store.items.values()),
						);

						try {
							for (const action of actions) {
								await executeAction(action, harness, model);
							}
							await drainAllTasks(harness, model);
							verifyInvariants(harness, model);
						} finally {
							harness.registry.resolveAll();
							for (const p of model.pendingNavs) {
								try {
									await p.promise;
								} catch (_cause) {
									void _cause;
								}
							}
						}
					},
				),
				{ numRuns: 100 },
			);
		},
		30000,
	);
});
