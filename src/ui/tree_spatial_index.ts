export interface ScreenRectangle {
	x1: number;
	x2: number;
	y1: number;
	y2: number;
}

export interface ScreenPositionedNode {
	id: string;
	x: number;
	y: number;
}

export interface TreeSpatialIndex<T extends ScreenPositionedNode> {
	cellSize: number;
	grid: Map<string, T[]>;
}

export function buildTreeSpatialIndex<T extends ScreenPositionedNode>(
	nodes: readonly T[],
	cellSize = 96,
): TreeSpatialIndex<T> {
	const grid = new Map<string, T[]>();
	for (const node of nodes) {
		const key = cellKey(node.x, node.y, cellSize);
		const bucket = grid.get(key) ?? [];
		bucket.push(node);
		grid.set(key, bucket);
	}
	return { cellSize, grid };
}

export function nodesNearRectangle<T extends ScreenPositionedNode>(
	index: TreeSpatialIndex<T>,
	rectangle: ScreenRectangle,
): T[] {
	const minCellX = Math.floor(rectangle.x1 / index.cellSize);
	const maxCellX = Math.floor(rectangle.x2 / index.cellSize);
	const minCellY = Math.floor(rectangle.y1 / index.cellSize);
	const maxCellY = Math.floor(rectangle.y2 / index.cellSize);
	const result: T[] = [];
	for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
		for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
			const bucket = index.grid.get(`${cellX}:${cellY}`);
			if (bucket) result.push(...bucket);
		}
	}
	return result;
}

export function screenRectanglesOverlap(
	left: ScreenRectangle,
	right: ScreenRectangle,
): boolean {
	return left.x1 < right.x2 && left.x2 > right.x1 && left.y1 < right.y2 && left.y2 > right.y1;
}

function cellKey(x: number, y: number, cellSize: number): string {
	return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}
