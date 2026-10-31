import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Unplaced Inbox renders in a feature view while mutations stay in its controller", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const view = await readFile(
		new URL("../../../src/ui/UnplacedInboxView.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/work_controller.svelte.ts", import.meta.url),
		"utf8",
	);

	expect(app).toMatch(/viewMode === "unplaced"/);
	expect(app).toMatch(/<UnplacedInboxView/);
	expect(controller).toMatch(/ports\.api\.updateUnplacedWorkText/);
	expect(controller).toMatch(/ports\.api\.placeUnplacedWork/);
	expect(controller).toMatch(/ports\.api\.createLink/);
	expect(view).toMatch(/matchesOutlineFilter/);
	expect(view).toMatch(/onUpdateText/);
	expect(view).toMatch(/onPlace/);
	expect(view).toMatch(/onLink/);
	expect(view).not.toMatch(/\bapi\./);
	expect(app).not.toMatch(/api\.(updateUnplacedWorkText|placeUnplacedWork)/);
});
