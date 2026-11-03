import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Duplicate candidates view is reachable and acts only through bindings", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const panel = await readFile(
		new URL("../../../src/ui/DuplicateCandidatesPanel.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/work_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const bindings = await readFile(
		new URL("../../../src/shared/bindings.ts", import.meta.url),
		"utf8",
	);

	expect(bindings.includes("listDuplicateCandidates(")).toBeTruthy();
	const lists = await readFile(
		new URL("../../../src/ui/work_list_state.svelte.ts", import.meta.url),
		"utf8",
	);
	expect(controller.includes("createWorkListState(ports.api)")).toBeTruthy();
	expect(lists.includes("this.api.listDuplicateCandidates(")).toBeTruthy();
	expect(app.includes('"duplicates"')).toBeTruthy();
	expect(app.includes("openDuplicates")).toBeTruthy();
	expect(app.includes("<DuplicateCandidatesPanel")).toBeTruthy();
	expect(app.includes("candidates={duplicateCandidates}")).toBeTruthy();
	expect(app.includes("onRequestMerge={requestDuplicateMerge}")).toBeTruthy();
	expect(app.includes("onCreateLink={createDuplicateCandidateLink}")).toBeTruthy();
	expect(app.includes("onDismiss={excludeDuplicateCandidate}")).toBeTruthy();
	expect(panel.includes("vocabulary.duplicateCandidates")).toBeTruthy();
	expect(panel.includes("vocabulary.duplicateReason")).toBeTruthy();
	expect(/直接|store\./.test(app)).toBe(false);
});

test("Duplicate candidates view keeps merge, link adoption, and dismissal explicit", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const bindings = await readFile(
		new URL("../../../src/shared/bindings.ts", import.meta.url),
		"utf8",
	);
	const desktop = await readFile(
		new URL("../../../src/desktop/register_bindings.ts", import.meta.url),
		"utf8",
	);

	const panel = await readFile(
		new URL("../../../src/ui/DuplicateCandidatesPanel.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/work_controller.svelte.ts", import.meta.url),
		"utf8",
	);

	expect(
		panel.includes("onRequestMerge(candidate.workB.workId, candidate.workA.workId)"),
	).toBeTruthy();
	expect(
		panel.includes("onRequestMerge(candidate.workA.workId, candidate.workB.workId)"),
	).toBeTruthy();
	for (const code of [
		"duplicateCandidateHint",
		"duplicateCandidateActions",
		"duplicateMerge",
		"duplicateKeepLeft",
		"duplicateKeepRight",
		"duplicateCreateLike",
		"duplicateCreateRelated",
		"duplicateDismiss",
	]) {
		expect(panel.includes(`vocabulary.${code}`), `missing vocabulary.${code}`).toBeTruthy();
	}
	expect(
		/実身|化身|項目|リンク/.test(panel),
		"duplicate panel must not contain literal Japanese terms",
	).toBe(false);
	expect(controller).toMatch(
		/ports\.api\.createLink\(\{[\s\S]*?origin: "human",[\s\S]*?status: "asserted",[\s\S]*?reason: duplicateCandidateReason\(candidate\)/,
	);
	expect(controller.includes("excludedDuplicateCandidateKeys")).toBeTruthy();
	expect(
		controller.includes('ports.requestConfirmation({ action: "merge-duplicate", preview })'),
	).toBeTruthy();
	expect(app.includes("workController.confirmDuplicateMerge(confirmation.preview)")).toBeTruthy();
	expect(bindings.includes("previewWorkMerge(")).toBeTruthy();
	expect(bindings.includes("mergeWorks(")).toBeTruthy();
	expect(desktop.includes("service().previewWorkMerge(sourceWorkId, survivorWorkId)")).toBeTruthy();
	expect(desktop.includes("service().mergeWorks(preview)")).toBeTruthy();
});

test("Work list state only calls read-only APIs", async () => {
	const lists = await readFile(
		new URL("../../../src/ui/work_list_state.svelte.ts", import.meta.url),
		"utf8",
	);
	expect(lists.includes('await this.prepareScreen("duplicates")')).toBeTruthy();
	expect(lists.includes("this.api.listDuplicateCandidates(")).toBeTruthy();

	const writeApis = [
		"createLink",
		"createStub",
		"quickCapture",
		"placeUnplacedWork",
		"createItem",
		"createOccurrence",
		"updateUnplacedWorkText",
		"resolveStub",
		"trashWork",
		"restoreWork",
		"purgeWork",
		"deleteLink",
		"moveItem",
		"updateItemText",
		"saveSearchAlias",
		"deleteSearchAlias",
		"renameTag",
		"mergeTags",
	];

	for (const api of writeApis) {
		expect(lists.includes(`api.${api}(`), `Work list state must not call write API: ${api}`).toBe(
			false,
		);
	}
});
