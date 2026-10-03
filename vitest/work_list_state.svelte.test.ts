import { expect, test, vi } from "vitest";
import type { DuplicateCandidate } from "../src/services/duplicate_candidates.ts";
import { createWorkListState } from "../src/ui/work_list_state.svelte.ts";

const candidate: DuplicateCandidate = {
	workA: { workId: "a", title: "a" },
	workB: { workId: "b", title: "b" },
	score: 3,
	reasons: [{ kind: "title", label: "same title", score: 3 }],
};

function setup() {
	const api = {
		listUnplacedWorks: vi.fn(async () => []),
		listStubs: vi.fn(async () => []),
		listDuplicateCandidates: vi.fn(async () => [candidate]),
		listTrash: vi.fn(async () => []),
	};
	return { api, state: createWorkListState(api) };
}

test("preparing a Work list does not publish before navigation commits", async () => {
	const { state } = setup();
	const publish = await state.prepareScreen("duplicates");
	expect(state.duplicateCandidates).toEqual([]);
	publish();
	expect(state.duplicateCandidates).toEqual([candidate]);
});

test("publication respects exclusions made while the request was pending", async () => {
	const { state } = setup();
	const publish = await state.prepareScreen("duplicates");
	state.excludeDuplicateCandidate(candidate);
	publish();
	expect(state.duplicateCandidates).toEqual([]);
	await state.loadDuplicates();
	expect(state.duplicateCandidates).toEqual([]);
});

test("failed list preparation preserves the published state", async () => {
	const { api, state } = setup();
	await state.loadDuplicates();
	api.listDuplicateCandidates.mockRejectedValueOnce(new Error("offline"));
	await expect(state.prepareScreen("duplicates")).rejects.toThrow("offline");
	expect(state.duplicateCandidates).toEqual([candidate]);
});
