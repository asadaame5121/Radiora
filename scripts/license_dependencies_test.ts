import { collectRuntimeDependencies } from "./license_dependencies.ts";

Deno.test("pnpm runtime licenses include roots and transitive dependencies, excluding dev tools", async () => {
	const entries = await collectRuntimeDependencies();
	const names = new Set(entries.map((entry) => entry.name));
	for (const name of ["bits-ui", "d3", "neverthrow", "overtype", "svelte", "valibot", "d3-array"]) {
		if (!names.has(name)) throw new Error(`Missing runtime dependency: ${name}`);
	}
	if (names.has("@biomejs/biome") || names.has("vitest")) {
		throw new Error("Development dependencies leaked into runtime licenses");
	}
	for (const entry of entries) {
		if (!entry.version || !entry.licenseLabel) throw new Error("Missing license metadata");
		await Deno.stat(new URL("package.json", entry.directory));
	}
});
