import type { OutlineSnapshot } from "../domain/models.ts";
import type { BrowsingOutlineProjection } from "../services/browsing_navigation_state.ts";
import { EMPTY_OUTLINE_FILTER, type OutlineFilter } from "../services/outline_filter.ts";
import { buildVisibleRows } from "./outline_view_model.ts";

/** Live Outline display conditions; the screen workspace only keeps a suspended copy. */
export class OutlineDisplayController {
	private liveFilter = $state<OutlineFilter>({ ...EMPTY_OUTLINE_FILTER });
	private liveExpanded = $state<string[]>([]);
	get filter() {
		return this.liveFilter;
	}
	get expanded() {
		return this.liveExpanded;
	}
	setFilter(value: OutlineFilter): void {
		this.liveFilter = { ...value };
	}
	clearFilter(): void {
		this.setFilter({ ...EMPTY_OUTLINE_FILTER });
	}
	setExpanded(ids: readonly string[]): void {
		this.liveExpanded = [...new Set(ids)];
	}
	expand(id: string): void {
		this.setExpanded([...this.liveExpanded, id]);
	}
	clearExpansion(id: string): void {
		this.setExpanded(this.liveExpanded.filter((key) => key !== id));
	}
	visibleRows(
		snapshot: OutlineSnapshot,
		projection: BrowsingOutlineProjection,
		showStash: boolean,
	) {
		return buildVisibleRows(snapshot, projection, this.liveExpanded, showStash);
	}
}
