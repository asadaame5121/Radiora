import type { VisibleRow } from "./outline_view_model.ts";

/** ARIA positions describe logical siblings, not the currently mounted window. */
export function outlineAccessibility(rows: readonly VisibleRow[]) {
	const sizes = new Map<string | null, number>();
	const positions = new Map<string | null, number>();
	for (const row of rows) {
		const parent = row.item.parentId;
		sizes.set(parent, (sizes.get(parent) ?? 0) + 1);
	}
	return rows.map((row) => {
		const parent = row.item.parentId;
		const position = (positions.get(parent) ?? 0) + 1;
		positions.set(parent, position);
		return { level: row.depth + 1, position, size: sizes.get(parent) ?? 1 };
	});
}
