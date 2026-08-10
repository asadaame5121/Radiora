import type { Branch, Occurrence, OutlineLink, Work, WorkingCopy } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";

export const DISCOVERY_TEST_NOW = "2026-07-30T12:00:00.000Z";

export async function addDiscoveryTestWork(
	store: MemoryGraphStore,
	id: string,
	text: string,
): Promise<Occurrence> {
	const work: Work = { id, createdAt: DISCOVERY_TEST_NOW, updatedAt: DISCOVERY_TEST_NOW };
	const branch: Branch = {
		id: `${id}-main`,
		workId: id,
		name: "main",
		headRevisionId: null,
		createdAt: DISCOVERY_TEST_NOW,
	};
	const copy: WorkingCopy = {
		branchId: branch.id,
		workId: id,
		text,
		updatedAt: DISCOVERY_TEST_NOW,
	};
	const occurrence: Occurrence = {
		id: `${id}-occ`,
		workId: id,
		parentOccurrenceId: null,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
	};
	await store.createWorkBundle(work, branch, copy, occurrence);
	return occurrence;
}

export async function addDiscoveryTestLink(
	store: MemoryGraphStore,
	fromId: string,
	toId: string,
	type: OutlineLink["type"],
): Promise<void> {
	await store.createLink({
		id: `${fromId}-${toId}-${type}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type,
		status: "asserted",
		origin: "human",
		createdAt: DISCOVERY_TEST_NOW,
	});
}
