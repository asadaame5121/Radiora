import { parse } from "valibot";
import { type HistoricalTime, HistoricalTimeSchema } from "../domain/historical_time.ts";
import type { Work } from "../domain/models.ts";
import { CreatedAtSchema } from "../domain/relation_type.ts";

export function updateHistoricalTime(
	works: Work[],
	workId: string,
	value: HistoricalTime | null,
	updatedAt: string,
): void {
	const work = works.find((candidate) =>
		candidate.id === workId && !candidate.deletedAt && !candidate.mergedIntoWorkId
	);
	if (!work) throw new Error(`Work not found: ${workId}`);
	const timestamp = parse(CreatedAtSchema, updatedAt);
	if (value === null) delete work.historicalTime;
	else work.historicalTime = structuredClone(parse(HistoricalTimeSchema, value));
	work.updatedAt = timestamp;
}

export function resolveWorkStub(works: Work[], workId: string, updatedAt: string): Work[] {
	const work = works.find((candidate) => candidate.id === workId);
	if (!work) throw new Error(`Work not found: ${workId}`);
	if (!work.stub) throw new Error(`Work is not a Stub: ${workId}`);
	return works.map((candidate) => {
		if (candidate.id !== workId) return candidate;
		const resolved = { ...candidate, updatedAt };
		delete resolved.stub;
		return resolved;
	});
}
