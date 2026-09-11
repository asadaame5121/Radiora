import * as v from "valibot";
import { HistoricalTimeSchema } from "../domain/historical_time.ts";
import { IdSchema } from "../domain/schemas.ts";
import type { WorkStorePort } from "../storage/graph_store.ts";

export async function setWorkHistoricalTime(
	store: Pick<WorkStorePort, "setWorkHistoricalTime">,
	workId: string,
	value: unknown,
): Promise<void> {
	return store.setWorkHistoricalTime(
		v.parse(IdSchema, workId),
		v.parse(v.nullable(HistoricalTimeSchema), value),
		new Date().toISOString(),
	);
}
