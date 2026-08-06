// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import { calculateTreeLayout, lodForScreenCollisions } from "./tree_layout.ts";

Deno.test("an overview cluster keeps a stable id across camera changes", () => {
	const snapshot = outline(["one", "two", "three", "four"]);
	const options = {
		width: 300,
		height: 200,
		projectX: () => 50,
	};
	const zoomedOut = calculateTreeLayout(snapshot, {
		...options,
		camera: { k: 0.4, x: 0, y: 0 },
	});
	const cluster = zoomedOut.nodes.find((node) => node.aggregate);
	assert(cluster, "the dense items should be summarized at low zoom");

	const panned = calculateTreeLayout(snapshot, {
		...options,
		camera: { k: 0.4, x: -120, y: 55 },
	});
	const pannedCluster = panned.nodes.find((node) => node.aggregate);

	assertEquals(cluster.id, pannedCluster?.id);
	assertEquals(cluster.itemIds, pannedCluster?.itemIds);
	assert(cluster.bounds, "the cluster carries world-space bounds");
	assertEquals(cluster.count, 4);
	assertEquals(
		zoomedOut.nodes.reduce((total, node) => total + node.count, 0),
		4,
	);
});

Deno.test("screen collisions include nodes across spatial-hash cell boundaries", () => {
	assertEquals(
		lodForScreenCollisions([{ x: 0, y: 0 }, { x: 95, y: 100 }, { x: 96, y: 100 }]),
		"overview",
	);

	const snapshot = outline(["first", "second"]);
	snapshot.items[0].createdAt = "1970-01-01T00:01:59.750Z";
	snapshot.items[1].createdAt = "1970-01-01T00:02:00.250Z";
	const layout = calculateTreeLayout(snapshot, {
		width: 300,
		height: 200,
		projectX: (timestamp) => timestamp / 1_000,
		camera: { k: 0.4, x: 0, y: 0 },
	});
	assertEquals(layout.lod, "overview");
	assertEquals(layout.nodes.map((node) => node.count), [2]);
});

Deno.test("lane reservation converts screen-fixed label widths at low zoom", () => {
	const snapshot = outline(["first", "second"]);
	snapshot.items[0].createdAt = "1970-01-01T00:00:00.000Z";
	snapshot.items[1].createdAt = "1970-01-01T00:00:00.300Z";
	for (const item of snapshot.items) item.text = "1234567890123456";
	const layout = calculateTreeLayout(snapshot, {
		width: 600,
		height: 200,
		projectX: (timestamp) => timestamp,
		camera: { k: 0.5, x: 0, y: 0 },
	});

	assertEquals(layout.lod, "detail");
	assertEquals(new Set(layout.nodes.map((node) => node.lane)).size, 2);
});

function outline(ids: string[]): OutlineSnapshot {
	return {
		items: ids.map((id, orderKey): OutlineItem => ({
			id,
			workId: id,
			text: `${id} の内容`,
			parentId: null,
			orderKey,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: `${id}-branch` },
			createdAt: "2026-08-05T00:00:00.000Z",
			updatedAt: "2026-08-05T00:00:00.000Z",
		})),
		links: [],
		knots: [],
		stashItemIds: [],
	};
}
