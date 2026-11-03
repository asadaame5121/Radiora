import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Stub list view is reachable and acts only through bindings", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const view = await readFile(
		new URL("../../../src/ui/StubListView.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/work_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const lists = await readFile(
		new URL("../../../src/ui/work_list_state.svelte.ts", import.meta.url),
		"utf8",
	);
	expect(controller.includes("createWorkListState(ports.api)")).toBeTruthy();
	const bindings = await readFile(
		new URL("../../../src/shared/bindings.ts", import.meta.url),
		"utf8",
	);

	for (const method of ["listStubs", "createStub", "resolveStub"]) {
		expect(bindings.includes(`${method}(`)).toBeTruthy();
		if (method === "listStubs") expect(lists.includes(`this.api.${method}(`)).toBeTruthy();
		else expect(controller.includes(`ports.api.${method}(`)).toBeTruthy();
	}
	expect(app.includes('"stubs"')).toBeTruthy();
	expect(app.includes("openStubs")).toBeTruthy();
	expect(app.includes("<StubListView")).toBeTruthy();
	expect(view.includes("vocabulary.stubList")).toBeTruthy();
	expect(view.includes("vocabulary.stubContext")).toBeTruthy();
	expect(view.includes("vocabulary.backlink")).toBeTruthy();
	expect(controller).toMatch(/ports\.api\.createStub\("stub-list"\)/);
	expect(controller).toMatch(/ports\.api\.updateUnplacedWorkText\(entry\.workId, text\)/);
	expect(view).toMatch(/disabled=\{!entry\.hasText\}/);
	expect(view.includes("entry.backlinks")).toBeTruthy();
	expect(view.includes("createdViaLabel")).toBeTruthy();
	expect(/直接|store\./.test(app)).toBe(false);
});

test("Stub resolution is never triggered implicitly by text editing", async () => {
	const controller = await readFile(
		new URL("../../../src/ui/work_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const view = await readFile(
		new URL("../../../src/ui/StubListView.svelte", import.meta.url),
		"utf8",
	);

	const updateStubText = controller.match(/async function updateStubText[\s\S]*?\n\t\}/)?.[0] ?? "";
	expect(updateStubText.includes("ports.api.updateUnplacedWorkText(")).toBeTruthy();
	expect(
		updateStubText.includes("resolveStub"),
		"Editing the body must not implicitly resolve a Stub",
	).toBe(false);
	expect(view).toMatch(/onclick=\{\(\) => onResolve\(entry\.workId\)\}/);
});
