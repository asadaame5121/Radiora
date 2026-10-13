import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import type { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import type { AcceptanceFixtureOptions } from "./performance_fixture/acceptance.ts";

const BATCH_COLLAPSE_OCCURRENCE_COUNT = 100;

export interface MeasurementCaseDefinition {
	id: string;
	description: string;
	options: AcceptanceFixtureOptions;
	action: (store: SqliteGraphStore, state: GraphStateSnapshot) => Promise<void>;
}

export const MEASUREMENT_CASES: readonly MeasurementCaseDefinition[] = [
	{
		id: "1k-all-roots-text",
		description: "1,000 topics with all roots, single working copy text update",
		options: { seed: 42, nodeCount: 1_000, shape: "all-roots" },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(
				state.works[0].id,
				`${state.workingCopies[0].text}\nAppended line`,
				now,
			);
		},
	},
	{
		id: "1k-wide-collapse",
		description: "1,000 topics wide tree, single occurrence collapse",
		options: { seed: 42, nodeCount: 1_000, shape: "wide" },
		action: async (store, state) => {
			await store.updateOccurrence({ ...state.occurrences[0], collapsed: true });
		},
	},
	{
		id: "1k-balanced-move",
		description: "1,000 topics balanced tree, single occurrence move",
		options: { seed: 42, nodeCount: 1_000, shape: "balanced" },
		action: async (store, state) => {
			const target = state.occurrences[1];
			const newParent = state.occurrences[0];
			await store.updateOccurrence({
				...target,
				parentOccurrenceId: newParent.id,
				orderKey: 9999,
			});
		},
	},
	{
		id: "1k-deep-chain-text",
		description: "1,000 topics deep chain, single working copy text update",
		options: { seed: 42, nodeCount: 1_000, shape: "deep-chain" },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(
				state.works[500].id,
				`${state.workingCopies[500].text}\nAppended line`,
				now,
			);
		},
	},
	{
		id: "1k-deep-cycle-read",
		description: "1,000 topics deep cycle, read-only graph export",
		options: { seed: 42, nodeCount: 1_000, shape: "deep-cycle" },
		action: async (store) => {
			await store.exportGraphState();
		},
	},
	{
		id: "10k-balanced-text",
		description: "10,000 topics balanced tree, single working copy text update",
		options: { seed: 42, nodeCount: 10_000, shape: "balanced" },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(
				state.works[0].id,
				`${state.workingCopies[0].text}\nAppended line`,
				now,
			);
		},
	},
	{
		id: "10k-balanced-collapse",
		description: "10,000 topics balanced tree, single occurrence collapse",
		options: { seed: 42, nodeCount: 10_000, shape: "balanced" },
		action: async (store, state) => {
			await store.updateOccurrence({ ...state.occurrences[0], collapsed: true });
		},
	},
	{
		id: "10k-balanced-move",
		description: "10,000 topics balanced tree, single occurrence move",
		options: { seed: 42, nodeCount: 10_000, shape: "balanced" },
		action: async (store, state) => {
			const target = state.occurrences[1];
			const newParent = state.occurrences[0];
			await store.updateOccurrence({
				...target,
				parentOccurrenceId: newParent.id,
				orderKey: 9999,
			});
		},
	},
	{
		id: "10k-all-roots-batch-collapse",
		description: "10,000 topics all roots, batch collapse of 100 occurrences",
		options: { seed: 42, nodeCount: 10_000, shape: "all-roots" },
		action: async (store, state) => {
			await store.batch(async () => {
				const count = Math.min(BATCH_COLLAPSE_OCCURRENCE_COUNT, state.occurrences.length);
				for (let i = 0; i < count; i++) {
					await store.updateOccurrence({ ...state.occurrences[i], collapsed: true });
				}
			});
		},
	},
	{
		id: "10k-deep-chain-text",
		description: "10,000 topics deep chain, single working copy text update",
		options: { seed: 42, nodeCount: 10_000, shape: "deep-chain" },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(
				state.works[5000].id,
				`${state.workingCopies[5000].text}\nAppended line`,
				now,
			);
		},
	},
	{
		id: "10k-wide-collapse",
		description: "10,000 topics wide tree, single occurrence collapse",
		options: { seed: 42, nodeCount: 10_000, shape: "wide" },
		action: async (store, state) => {
			await store.updateOccurrence({ ...state.occurrences[0], collapsed: true });
		},
	},
	{
		id: "10k-baseline-2kb-text",
		description: "10,000 topics 2KB body, single working copy text update",
		options: { seed: 42, nodeCount: 10_000, shape: "balanced", bodyBytes: 2048 },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(state.works[0].id, `${state.workingCopies[0].text}x`, now);
		},
	},
	{
		id: "10k-baseline-4rev-text",
		description: "10,000 topics 4 revisions per work, single working copy text update",
		options: { seed: 42, nodeCount: 10_000, shape: "balanced", revisionsPerWork: 4 },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(
				state.works[0].id,
				`${state.workingCopies[0].text}\nAppended line`,
				now,
			);
		},
	},
	{
		id: "10k-baseline-8links-text",
		description: "10,000 topics 8x links, single working copy text update",
		options: { seed: 42, nodeCount: 10_000, shape: "balanced", linkMultiplier: 8 },
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(
				state.works[0].id,
				`${state.workingCopies[0].text}\nAppended line`,
				now,
			);
		},
	},
	{
		id: "10k-combined-text",
		description: "10,000 topics combined independent axes, text update",
		options: {
			seed: 42,
			nodeCount: 10_000,
			shape: "balanced",
			bodyBytes: 2048,
			revisionsPerWork: 4,
			linkMultiplier: 8,
			hub: true,
		},
		action: async (store, state) => {
			const now = new Date().toISOString();
			await store.updateWorkingCopy(state.works[0].id, `${state.workingCopies[0].text}x`, now);
		},
	},
];
