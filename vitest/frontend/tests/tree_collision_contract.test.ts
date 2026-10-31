import { expect, test } from "vitest";
import { lodForScreenCollisions } from "../../../src/ui/tree_layout.ts";

function oracle(nodes: readonly { x: number; y: number }[]): string {
	const colliding = new Set<number>();
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			if (Math.abs(nodes[i].x - nodes[j].x) < 48 && Math.abs(nodes[i].y - nodes[j].y) < 36) {
				colliding.add(i);
				colliding.add(j);
			}
		}
	}
	const fraction = colliding.size / nodes.length;
	return fraction >= 0.5 ? "overview" : fraction > 0 ? "context" : "detail";
}

test("P6 collision contract matches full-pair oracle at boundaries, pan, and zoom", () => {
	const cases = [
		[],
		[[0, 0]],
		[
			[0, 0],
			[48, 0],
		],
		[
			[0, 0],
			[47.999, 0],
		],
		[
			[0, 0],
			[0, 36],
		],
		[
			[0, 0],
			[0, 35.999],
		],
		[
			[0, 0],
			[47.999, 35.999],
		],
		[
			[0, 0],
			[47.999, 36.001],
		],
		[
			[10, 10],
			[10, 10],
			[58, 10],
		],
		Array.from({ length: 120 }, (_, i) => [(i * 37) % 200, (i * 53) % 200]),
	];
	for (const positions of cases) {
		const nodes = positions.map(([x, y]) => ({ x, y }));
		expect(lodForScreenCollisions(nodes)).toEqual(oracle(nodes));
		const panned = nodes.map(({ x, y }) => ({ x: x + 211, y: y - 73 }));
		expect(lodForScreenCollisions(panned)).toEqual(oracle(nodes));
		const zoomed = nodes.map(({ x, y }) => ({ x: x * 0.5, y: y * 0.5 }));
		expect(lodForScreenCollisions(zoomed)).toEqual(oracle(zoomed));
		expect(lodForScreenCollisions([...nodes].reverse())).toEqual(oracle(nodes));
	}
});
