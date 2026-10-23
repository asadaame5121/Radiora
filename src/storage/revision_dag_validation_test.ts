import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { Revision } from "../domain/models.ts";
import { assertRevisionDag } from "./revision_dag_validation.ts";

Deno.test("revision DAG validation accepts ancestry and reports a cycle at its first repeated revision", () => {
	const first: Revision = {
		id: "r1",
		workId: "work-1",
		text: "",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	const second: Revision = { ...first, id: "r2", parentRevisionIds: ["r1"] };

	assertEquals(assertRevisionDag([first, second]), undefined);
	assertThrows(
		() => assertRevisionDag([{ ...first, parentRevisionIds: ["r2"] }, second]),
		Error,
		"Revision cycle: r1",
	);
});
