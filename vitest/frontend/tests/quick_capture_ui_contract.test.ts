import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Quick Capture and unplaced inbox remain reachable and expose required actions", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const options = await readFile(
		new URL("../../../src/ui/OptionsView.svelte", import.meta.url),
		"utf8",
	);
	const unplaced = await readFile(
		new URL("../../../src/ui/UnplacedInboxView.svelte", import.meta.url),
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

	for (const method of [
		"quickCapture",
		"listUnplacedWorks",
		"updateUnplacedWorkText",
		"placeUnplacedWork",
	]) {
		expect(bindings.includes(`${method}(`)).toBeTruthy();
		if (method === "listUnplacedWorks") expect(lists.includes(`this.api.${method}(`)).toBeTruthy();
		else expect(controller.includes(`ports.api.${method}(`)).toBeTruthy();
	}
	expect(app.includes("vocabulary.quickCapture")).toBeTruthy();
	expect(app.includes("loadQuickCapturePreference()")).toBeTruthy();
	expect(app.includes("saveQuickCapturePreference")).toBeTruthy();
	expect(options.includes("quickCapturePreference.destination")).toBeTruthy();
	expect(controller.includes("ports.api.createItem({")).toBeTruthy();
	expect(options.includes("vocabulary.quickCaptureDestinationRoot")).toBeTruthy();
	expect(unplaced.includes("vocabulary.unplacedInbox")).toBeTruthy();
	expect(unplaced.includes("#タグ")).toBeTruthy();
	expect(unplaced.includes("Rootへ配置")).toBeTruthy();
	expect(unplaced.includes("selectedId")).toBeTruthy();
	expect(unplaced.includes("unplacedLinkDirections")).toBeTruthy();
	expect(controller.includes("ports.api.createLink({")).toBeTruthy();
});
