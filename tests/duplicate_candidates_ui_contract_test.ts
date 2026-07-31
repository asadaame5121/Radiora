import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("Duplicate candidates view is reachable and acts only through bindings", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const panel = await Deno.readTextFile(
		new URL("../src/ui/DuplicateCandidatesPanel.svelte", import.meta.url),
	);
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);

	assert(bindings.includes("listDuplicateCandidates("));
	assert(app.includes("api.listDuplicateCandidates("));
	assert(app.includes('"duplicates"'));
	assert(app.includes("openDuplicates"));
	assert(app.includes("<DuplicateCandidatesPanel"));
	assert(app.includes("candidates={duplicateCandidates}"));
	assert(app.includes("onRequestMerge={requestDuplicateMerge}"));
	assert(app.includes("onCreateLink={createDuplicateCandidateLink}"));
	assert(app.includes("onDismiss={excludeDuplicateCandidate}"));
	assert(panel.includes("vocabulary.duplicateCandidates"));
	assert(panel.includes("vocabulary.duplicateReason"));
	assertFalse(/直接|store\./.test(app));
});

Deno.test("Duplicate candidates view keeps merge, link adoption, and dismissal explicit", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);
	const desktop = await Deno.readTextFile(
		new URL("../src/desktop/register_bindings.ts", import.meta.url),
	);

	const panel = await Deno.readTextFile(
		new URL("../src/ui/DuplicateCandidatesPanel.svelte", import.meta.url),
	);

	assert(panel.includes("onRequestMerge(candidate.workB.workId, candidate.workA.workId)"));
	assert(panel.includes("onRequestMerge(candidate.workA.workId, candidate.workB.workId)"));
	for (
		const code of [
			"duplicateCandidateHint",
			"duplicateCandidateActions",
			"duplicateMerge",
			"duplicateKeepLeft",
			"duplicateKeepRight",
			"duplicateCreateLike",
			"duplicateCreateRelated",
			"duplicateDismiss",
		]
	) {
		assert(panel.includes(`vocabulary.${code}`), `missing vocabulary.${code}`);
	}
	assertFalse(
		/実身|化身|項目|リンク/.test(panel),
		"duplicate panel must not contain literal Japanese terms",
	);
	assertMatch(
		app,
		/api\.createLink\(\{[\s\S]*?origin: "human",[\s\S]*?status: "asserted",[\s\S]*?reason: duplicateCandidateReason\(candidate\)/,
	);
	assert(app.includes("excludedDuplicateCandidateKeys"));
	assert(app.includes('requestConfirmation({ action: "merge-duplicate", preview })'));
	assert(app.includes("await api.mergeWorks(confirmation.preview)"));
	assert(bindings.includes("previewWorkMerge("));
	assert(bindings.includes("mergeWorks("));
	assert(desktop.includes("service().previewWorkMerge(sourceWorkId, survivorWorkId)"));
	assert(desktop.includes("service().mergeWorks(preview)"));
});

Deno.test("loadDuplicates function only calls read-only API", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	const loadDuplicates = app.match(/async function loadDuplicates\(\)[\s\S]*?\n\t\}/)?.[0] ?? "";

	assert(loadDuplicates.length > 0, "loadDuplicates function not found");
	assert(loadDuplicates.includes("api.listDuplicateCandidates("));

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
		assertFalse(
			loadDuplicates.includes(`api.${api}(`),
			`loadDuplicates must not call write API: ${api}`,
		);
	}
});
