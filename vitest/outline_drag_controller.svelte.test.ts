import { expect, test, vi } from "vitest";
import { createOutlineDragController } from "../src/ui/outline_drag_controller.svelte.ts";

test("a completed move retains its source without clearing a subsequent drag", async () => {
	const pending = Promise.withResolvers<void>();
	const ports = {
		moveItem: vi.fn(() => pending.promise),
		reload: vi.fn(async () => true),
		reportError: vi.fn(),
	};
	const drag = createOutlineDragController(ports);
	drag.start("source");
	const saving = drag.dropOn({ id: "target", parentId: "parent" });
	expect(drag.draggedId).toBeNull();
	drag.end();
	drag.start("next-source");
	pending.resolve();
	await saving;
	expect(ports.moveItem).toHaveBeenCalledExactlyOnceWith({
		id: "source",
		parentId: "parent",
		afterId: "target",
	});
	expect(ports.reload).toHaveBeenCalledExactlyOnceWith("source");
	expect(drag.draggedId).toBe("next-source");
	expect(ports.reportError).not.toHaveBeenCalled();
});

test("a rejected move is reported without reloading or leaving an active drag", async () => {
	const cause = new Error("disk unavailable");
	const ports = {
		moveItem: vi.fn(async () => {
			throw cause;
		}),
		reload: vi.fn(async () => true),
		reportError: vi.fn(),
	};
	const drag = createOutlineDragController(ports);
	drag.start("source");
	await drag.dropOn({ id: "target", parentId: null });
	expect(drag.draggedId).toBeNull();
	expect(ports.reload).not.toHaveBeenCalled();
	expect(ports.reportError).toHaveBeenCalledExactlyOnceWith(cause);
	await drag.dropOn({ id: "target", parentId: null });
	expect(ports.moveItem).toHaveBeenCalledTimes(1);
});
