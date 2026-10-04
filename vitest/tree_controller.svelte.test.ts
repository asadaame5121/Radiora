import { expect, test, vi } from "vitest";
import type { GlobalLineageProjection } from "../src/services/branch_service.ts";
import { LINK_TYPES } from "../src/domain/models.ts";
import { TreeController } from "../src/ui/tree_controller.svelte.ts";
import { TREE_FILTER_STORAGE_KEY } from "../src/ui/tree_filter_preference.ts";
import { TREE_PROJECTION_STORAGE_KEY } from "../src/ui/tree_projection_preference.ts";

function projection(count: number): GlobalLineageProjection {
	return {
		snapshot: { items: [], links: [], knots: [], stashItemIds: [] },
		promotedBranches: [],
		totalWorkCount: count,
		filteredWorkCount: count,
	};
}
function setup() {
	let selectedWorkId: string | null = null;
	const values = new Map<string, string>();
	const storage = {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
	};
	const listGlobalLineage = vi.fn(async () => projection(1));
	const onError = vi.fn();
	const ports = { listGlobalLineage, selectedWorkId: () => selectedWorkId, onError };
	const preferences = { projectionStorage: storage, filterStorage: storage };
	const tree = new TreeController(ports, preferences);
	return {
		tree,
		ports,
		preferences,
		values,
		storage,
		listGlobalLineage,
		onError,
		select: (id: string | null) => {
			selectedWorkId = id;
		},
	};
}

test("Tree and Options commands share one settings writer across remounts and restart", () => {
	const s = setup();
	s.tree.setProjection("lineage");
	s.tree.setProjection("lineage");
	expect(s.storage.setItem).toHaveBeenCalledTimes(1);
	expect(s.values.get(TREE_PROJECTION_STORAGE_KEY)).toBe("lineage");
	const restarted = new TreeController(s.ports, s.preferences);
	expect(restarted.projectionPreference).toBe("lineage");
	s.storage.setItem.mockImplementation(() => {
		throw new Error("storage disabled");
	});
	expect(() => s.tree.setProjection("chronology")).not.toThrow();
	expect(s.tree.projectionPreference).toBe("chronology");
});

test("selected Work is derived per request and never persisted in the filter", async () => {
	const s = setup();
	s.select("work-a");
	s.tree.setFilter({ includeIsolated: false, linkTypes: ["FROM"], includeWorkIds: ["untrusted"] });
	await s.tree.refresh();
	expect(s.listGlobalLineage.mock.calls[0]).toEqual([{
		includeIsolated: false,
		linkTypes: ["FROM"],
		includeWorkIds: ["work-a"],
	}]);
	s.select("work-b");
	expect(s.tree.activeFilter().includeWorkIds).toEqual(["work-b"]);
	expect(s.tree.filter.includeWorkIds).toEqual([]);
	expect(JSON.parse(s.values.get(TREE_FILTER_STORAGE_KEY) ?? "{}")).toEqual({
		includeIsolated: false,
		linkTypes: ["FROM"],
	});
});

test("filter B wins reverse successes and stale A cannot clear B loading", async () => {
	const s = setup();
	const a = Promise.withResolvers<GlobalLineageProjection>();
	const b = Promise.withResolvers<GlobalLineageProjection>();
	s.listGlobalLineage.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
	const first = s.tree.refresh();
	s.tree.setFilter({ includeIsolated: false, linkTypes: ["FROM"], includeWorkIds: [] });
	const second = s.tree.refresh();
	a.resolve(projection(2));
	await first;
	expect(s.tree.loading).toBe(true);
	expect(s.tree.projection).toBeNull();
	b.resolve(projection(3));
	await second;
	expect(s.tree.projection?.totalWorkCount).toBe(3);
	expect(s.tree.loading).toBe(false);
});

test("stale failure does not replace current data/error or report to App", async () => {
	const s = setup();
	const a = Promise.withResolvers<GlobalLineageProjection>();
	s.listGlobalLineage.mockReturnValueOnce(a.promise);
	const first = s.tree.refresh();
	s.select("b");
	await s.tree.refresh();
	a.reject(new Error("old offline"));
	await first;
	expect(s.tree.error).toBeNull();
	expect(s.tree.projection?.totalWorkCount).toBe(1);
	expect(s.onError).not.toHaveBeenCalled();
});

test("staging reload delays publication and cancelling it cannot invalidate a newer request", async () => {
	const s = setup();
	const reload = s.tree.prepareRefresh();
	const loaded = await reload.result;
	expect(s.tree.projection).toBeNull();
	const newer = s.tree.prepareRefresh();
	reload.cancel();
	reload.publish(loaded);
	expect(s.tree.projection).toBeNull();
	newer.publish(await newer.result);
	expect(s.tree.projection?.totalWorkCount).toBe(1);
});

test("selection changes invalidate staged results even without another fetch", async () => {
	const s = setup();
	const request = s.tree.prepareRefresh();
	s.select("different-work");
	request.publish(await request.result);
	expect(s.tree.projection).toBeNull();
	expect(s.tree.loading).toBe(false);
	expect(s.tree.needsRefresh(s.tree.filterKey())).toBe(true);
});

test("leaving Tree and dispose discard old requests; re-entry and retry remain usable", async () => {
	const s = setup();
	const pending = Promise.withResolvers<GlobalLineageProjection>();
	s.listGlobalLineage.mockReturnValueOnce(pending.promise);
	const first = s.tree.refresh();
	s.tree.invalidate();
	pending.resolve(projection(5));
	await first;
	expect(s.tree.projection).toBeNull();
	s.listGlobalLineage.mockRejectedValueOnce(new Error("offline"));
	await s.tree.refresh();
	expect(s.onError).toHaveBeenCalledOnce();
	expect(s.tree.loading).toBe(false);
	await s.tree.refresh();
	expect(s.tree.error).toBeNull();
	expect(s.tree.projection?.totalWorkCount).toBe(1);
	const last = s.tree.prepareRefresh();
	s.tree.dispose();
	last.publish(await last.result);
	await s.tree.refresh();
	const ignored = s.tree.prepareRefresh();
	ignored.publish(await ignored.result);
	expect(s.tree.loading).toBe(false);
	expect(s.listGlobalLineage).toHaveBeenCalledTimes(4);
});

test("startup/backup reload stored filters and catalogue changes use the same reconciliation", () => {
	const s = setup();
	s.values.set(
		TREE_FILTER_STORAGE_KEY,
		JSON.stringify({ includeIsolated: false, linkTypes: ["FROM"] }),
	);
	s.tree.reconcileRelations(LINK_TYPES, true);
	expect(s.tree.filter.includeIsolated).toBe(false);
	expect(s.tree.filter.linkTypes).toEqual([
		"FROM",
		...LINK_TYPES.filter((name) => name !== "FROM"),
	]);
	s.tree.reconcileRelations([...LINK_TYPES, "CAUSES"]);
	expect(s.tree.filter.linkTypes).toContain("CAUSES");
	expect(s.tree.filter.includeWorkIds).toEqual([]);
});

test("latest success survives a reverse-order stale success", async () => {
	const s = setup();
	const a = Promise.withResolvers<GlobalLineageProjection>();
	const b = Promise.withResolvers<GlobalLineageProjection>();
	s.listGlobalLineage.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
	const first = s.tree.refresh();
	s.tree.setFilter({ includeIsolated: false, linkTypes: ["FROM"], includeWorkIds: [] });
	const second = s.tree.refresh();
	b.resolve(projection(3));
	await second;
	a.resolve(projection(2));
	await first;
	expect(s.tree.projection?.totalWorkCount).toBe(3);
	expect(s.tree.error).toBeNull();
	expect(s.tree.loading).toBe(false);
});

test("latest failure retains previous data and cannot be cleared by a stale success", async () => {
	const s = setup();
	await s.tree.refresh();
	const a = Promise.withResolvers<GlobalLineageProjection>();
	const b = Promise.withResolvers<GlobalLineageProjection>();
	s.listGlobalLineage.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
	const first = s.tree.refresh();
	s.select("new-work");
	const second = s.tree.refresh();
	const cause = new Error("current offline");
	b.reject(cause);
	await second;
	a.resolve(projection(4));
	await first;
	expect(s.tree.error).toBe(cause);
	expect(s.tree.projection?.totalWorkCount).toBe(1);
	expect(s.tree.loading).toBe(false);
	expect(s.onError).toHaveBeenCalledOnce();
});
