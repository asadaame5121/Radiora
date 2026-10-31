import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Recovery Snapshot UI is reachable from Work lineage and uses explicit actions", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const component = await readFile(
		new URL("../../../src/ui/RecoverySnapshots.svelte", import.meta.url),
		"utf8",
	);
	const bindings = await readFile(
		new URL("../../../src/shared/bindings.ts", import.meta.url),
		"utf8",
	);

	expect(app.includes("<RecoverySnapshots")).toBeTruthy();
	expect(app).toMatch(/viewMode === "workLineage"/);
	expect(component.includes("この状態を復元")).toBeTruthy();
	expect(component.includes("この状態を稿として保存")).toBeTruthy();
	expect(component.includes("vocabulary.recoverySnapshot")).toBeTruthy();
	expect(bindings.includes("previewRecoverySnapshot")).toBeTruthy();
	expect(bindings.includes("restoreRecoverySnapshot")).toBeTruthy();
	expect(bindings.includes("promoteRecoverySnapshot")).toBeTruthy();
});
