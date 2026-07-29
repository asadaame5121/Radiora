import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("Recovery Snapshot UI is reachable from Work lineage and uses explicit actions", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const component = await Deno.readTextFile(
		new URL("../src/ui/RecoverySnapshots.svelte", import.meta.url),
	);
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);

	assert(app.includes("<RecoverySnapshots"));
	assertMatch(app, /viewMode === "workLineage"/);
	assert(component.includes("この状態を復元"));
	assert(component.includes("この状態を稿として保存"));
	assert(component.includes("vocabulary.recoverySnapshot"));
	assert(bindings.includes("previewRecoverySnapshot"));
	assert(bindings.includes("restoreRecoverySnapshot"));
	assert(bindings.includes("promoteRecoverySnapshot"));
});
