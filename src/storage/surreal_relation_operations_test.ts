import { assertEquals } from "jsr:@std/assert";
import type { OutlineLink } from "../domain/models.ts";
import { duplicateLinkIdsAfterMerge } from "./surreal_relation_operations.ts";

Deno.test("duplicateLinkIdsAfterMerge - detects duplicate link ids after merge", () => {
	const links: OutlineLink[] = [
		{
			id: "link-1",
			fromId: "w-source",
			toId: "w-other",
			type: "LIKE",
			from: { scope: "work", workId: "w-source" },
			to: { scope: "work", workId: "w-other" },
			status: "asserted",
			origin: "human",
			createdAt: "2026-01-01T00:00:00Z",
		},
		{
			id: "link-2",
			fromId: "w-survivor",
			toId: "w-other",
			type: "LIKE",
			from: { scope: "work", workId: "w-survivor" },
			to: { scope: "work", workId: "w-other" },
			status: "asserted",
			origin: "human",
			createdAt: "2026-01-01T00:00:00Z",
		},
	];

	const duplicates = duplicateLinkIdsAfterMerge(links, "w-source", "w-survivor");
	assertEquals(duplicates, ["link-2"]);
});
