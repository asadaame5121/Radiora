import type { Occurrence } from "../domain/models.ts";
import type { GraphStore, WorkBundle } from "../storage/graph_store.ts";
import { type OpmlNode, parseOpml, renderOutlineSnapshotOpml } from "./opml.ts";

const ORDER_STEP = 1024;

export interface OpmlImportResult {
	importedCount: number;
}

export class OpmlService {
	constructor(private readonly store: GraphStore) {}

	async export(): Promise<string> {
		return renderOutlineSnapshotOpml({
			items: await this.store.listItems(),
			links: [],
			knots: [],
			stashItemIds: [],
		});
	}

	async import(source: string): Promise<OpmlImportResult> {
		const roots = parseOpml(source);
		if (roots.length === 0) throw new Error("OPMLに項目がありません。");
		const existing = await this.store.listItems();
		const lastRootOrder = existing
			.filter((item) => item.parentId === null)
			.reduce((maximum, item) => Math.max(maximum, item.orderKey), 0);
		const bundles: WorkBundle[] = [];
		const append = (
			nodes: readonly OpmlNode[],
			parentOccurrenceId: string | null,
			firstOrderKey: number,
		): void => {
			for (const [index, node] of nodes.entries()) {
				const bundle = importedBundle(
					node.text,
					parentOccurrenceId,
					firstOrderKey + index * ORDER_STEP,
				);
				bundles.push(bundle);
				append(node.children, bundle.occurrence.id, ORDER_STEP);
			}
		};
		append(roots, null, lastRootOrder + ORDER_STEP);
		await this.store.importWorkBundles(bundles);
		return { importedCount: bundles.length };
	}
}

function importedBundle(
	text: string,
	parentOccurrenceId: string | null,
	orderKey: number,
): WorkBundle {
	const now = new Date().toISOString();
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	const occurrence: Occurrence = {
		id: crypto.randomUUID(),
		workId,
		parentOccurrenceId,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId },
	};
	return {
		work: { id: workId, createdAt: now, updatedAt: now },
		branch: {
			id: branchId,
			workId,
			name: "main",
			headRevisionId: null,
			createdAt: now,
		},
		workingCopy: { branchId, workId, text, updatedAt: now },
		occurrence,
	};
}
