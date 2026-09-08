import type { MoveItemInput, OutlineItem } from "../domain/models.ts";

interface OutlineDragPorts {
	moveItem(input: MoveItemInput): Promise<void>;
	reload(focusId: string): Promise<unknown>;
	reportError(cause: unknown): void;
}

/** Owns an Outline drag from its source row through drop or cancellation. */
export function createOutlineDragController(ports: OutlineDragPorts) {
	let draggedId = $state<string | null>(null);

	function start(id: string): void {
		draggedId = id;
	}

	function end(): void {
		draggedId = null;
	}

	async function dropOn(target: Pick<OutlineItem, "id" | "parentId">): Promise<void> {
		const sourceId = draggedId;
		end();
		if (!sourceId || sourceId === target.id) return;
		try {
			await ports.moveItem({ id: sourceId, parentId: target.parentId, afterId: target.id });
			await ports.reload(sourceId);
		} catch (cause) {
			ports.reportError(cause);
		}
	}

	return {
		get draggedId() {
			return draggedId;
		},
		start,
		end,
		dropOn,
	};
}
