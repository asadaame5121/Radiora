/** A single actionable entry in the shared application context menu. */
export interface ContextMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly reason?: string;
	readonly danger?: boolean;
	readonly separatorBefore?: boolean;
}

export interface ContextMenuPosition {
	readonly left: number;
	readonly top: number;
}

/**
 * Keeps a viewport-coordinate menu fully visible while preserving the pointer
 * position whenever there is enough room.
 */
export function contextMenuPosition(
	x: number,
	y: number,
	menuWidth: number,
	menuHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	margin = 8,
): ContextMenuPosition {
	const safeMargin = Math.max(0, margin);
	const width = Math.max(0, menuWidth);
	const height = Math.max(0, menuHeight);
	const maxLeft = Math.max(safeMargin, viewportWidth - width - safeMargin);
	const maxTop = Math.max(safeMargin, viewportHeight - height - safeMargin);
	return {
		left: clamp(x, safeMargin, maxLeft),
		top: clamp(y, safeMargin, maxTop),
	};
}

/** Returns the next enabled item index, wrapping at either end. */
export function nextEnabledContextMenuIndex(
	items: readonly ContextMenuItem[],
	currentIndex: number,
	direction: -1 | 1,
): number {
	const enabled = items
		.map((item, index) => item.disabled ? -1 : index)
		.filter((index) => index >= 0);
	if (enabled.length === 0) return -1;
	const currentEnabledIndex = enabled.indexOf(currentIndex);
	if (currentEnabledIndex < 0) return direction === 1 ? enabled[0] : enabled[enabled.length - 1];
	return enabled[(currentEnabledIndex + direction + enabled.length) % enabled.length];
}

export function firstEnabledContextMenuIndex(items: readonly ContextMenuItem[]): number {
	return items.findIndex((item) => !item.disabled);
}

export function lastEnabledContextMenuIndex(items: readonly ContextMenuItem[]): number {
	for (let index = items.length - 1; index >= 0; index--) {
		if (!items[index].disabled) return index;
	}
	return -1;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}
