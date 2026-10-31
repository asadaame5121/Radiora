import {
	checkBoundaries,
	type DependencyGraph,
	graphFromMetadata,
	parseMetadata,
} from "./rust_crate_boundaries.ts";

function graph(edges: Record<string, string[]>, members?: string[]): DependencyGraph {
	return {
		members: members ?? ["radiora-core", "radiora-infra", "radiora-desktop"],
		edges: new Map(Object.entries(edges).map(([from, to]) => [from, new Set(to)])),
	};
}

const valid = {
	"radiora-core": ["serde", "petgraph"],
	"radiora-infra": ["radiora-core", "loro", "rusqlite"],
	"radiora-desktop": ["radiora-core", "radiora-infra", "tauri", "tauri-plugin-dialog"],
	tauri: ["tauri-runtime"],
	loro: ["loro-internal"],
};

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

Deno.test("the intended layering has no violation", () => {
	assert(checkBoundaries(graph(valid)).length === 0, "valid graph rejected");
});

Deno.test("core depending on loro, rusqlite or tauri directly is rejected", () => {
	for (const banned of ["loro", "rusqlite", "tauri"]) {
		const violations = checkBoundaries(graph({ ...valid, "radiora-core": ["serde", banned] }));
		assert(
			violations.some((v) => v.from === "radiora-core" && v.forbidden.startsWith(banned)),
			`core -> ${banned} accepted`,
		);
	}
});

Deno.test("core reaching infra through an intermediate crate is rejected with its path", () => {
	const violations = checkBoundaries(
		graph({ ...valid, "radiora-core": ["helper"], helper: ["radiora-infra"] }),
	);
	const hit = violations.find((v) => v.from === "radiora-core" && v.forbidden === "radiora-infra");
	assert(hit?.path.join(">") === "radiora-core>helper>radiora-infra", "indirect path not reported");
});

Deno.test("infra reaching tauri plugins or desktop is rejected", () => {
	assert(
		checkBoundaries(graph({ ...valid, "radiora-infra": ["tauri-plugin-fs"] })).length > 0,
		"infra -> tauri plugin accepted",
	);
	assert(
		checkBoundaries(graph({ ...valid, "radiora-infra": ["radiora-desktop"] })).length > 0,
		"infra -> desktop accepted",
	);
});

Deno.test("nothing may depend on desktop and desktop must not use loro or rusqlite directly", () => {
	assert(
		checkBoundaries(graph({ ...valid, "radiora-core": ["radiora-desktop"] })).length > 0,
		"core -> desktop accepted",
	);
	assert(
		checkBoundaries(graph({ ...valid, "radiora-desktop": ["radiora-infra", "loro"] })).length > 0,
		"desktop -> loro accepted",
	);
});

Deno.test("an unruled workspace member or a missing required member fails closed", () => {
	const extra = graph(valid, ["radiora-core", "radiora-infra", "radiora-desktop", "radiora-new"]);
	assert(checkBoundaries(extra).length === 1, "unruled member accepted");
	const missing = graph(valid, ["radiora-core", "radiora-infra"]);
	assert(checkBoundaries(missing).length === 1, "missing member accepted");
});

Deno.test("metadata parsing rejects an unexpected shape and maps ids to names", () => {
	let rejected = false;
	try {
		parseMetadata({ packages: [] });
	} catch {
		rejected = true;
	}
	assert(rejected, "malformed metadata accepted");
	const parsed = graphFromMetadata(
		parseMetadata({
			packages: [
				{ id: "a 0.0.0", name: "radiora-core" },
				{ id: "b 1.0.0", name: "loro" },
			],
			workspace_members: ["a 0.0.0"],
			resolve: { nodes: [{ id: "a 0.0.0", deps: [{ pkg: "b 1.0.0" }] }] },
		}),
	);
	assert(
		checkBoundaries(parsed).some((v) => v.forbidden === "loro"),
		"metadata path not checked",
	);
});
