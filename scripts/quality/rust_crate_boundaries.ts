// Enforces the crate boundaries of docs/design/v3-architecture.md section 1 against the real
// cargo metadata dependency graph. Only the pure rule evaluation is unit-tested; the CLI wrapper
// shells out to cargo and fails closed on every unexpected input.

export type DependencyGraph = {
	/** Workspace member package names. */
	members: string[];
	/** Package name -> names of packages it depends on (normal, build and dev kinds). */
	edges: Map<string, Set<string>>;
};

export type Violation = { from: string; forbidden: string; path: string[] };

type Rule = {
	/** Package names (or `prefix*`) the crate must not reach, directly or transitively. */
	mustNotReach: string[];
	/** Package names (or `prefix*`) the crate must not depend on directly. */
	mustNotDependOn: string[];
};

const ADAPTER_AND_HOST_CRATES = ["loro", "rusqlite", "tauri", "tauri-*"];

export const RULES: Record<string, Rule> = {
	"radiora-core": {
		mustNotReach: ["radiora-infra", "radiora-desktop", ...ADAPTER_AND_HOST_CRATES],
		mustNotDependOn: [],
	},
	"radiora-infra": {
		mustNotReach: ["radiora-desktop", "tauri", "tauri-*"],
		mustNotDependOn: [],
	},
	"radiora-desktop": {
		mustNotReach: [],
		// The desktop host composes adapters; it must not reach Loro/SQLite itself.
		mustNotDependOn: ["loro", "rusqlite"],
	},
};

/** Nothing may depend on the composition root. */
const ROOT_CRATE = "radiora-desktop";

function matches(name: string, pattern: string): boolean {
	return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

function reconstruct(previous: Map<string, string>, from: string, to: string): string[] {
	const path = [to];
	let cursor = to;
	while (cursor !== from) {
		cursor = previous.get(cursor) ?? from;
		path.push(cursor);
	}
	return path.reverse();
}

function findPath(graph: DependencyGraph, from: string, pattern: string): string[] | null {
	const previous = new Map<string, string>();
	const queue = [from];
	const seen = new Set(queue);
	for (let head = 0; head < queue.length; head++) {
		const current = queue[head] ?? from;
		for (const next of graph.edges.get(current) ?? []) {
			if (seen.has(next)) continue;
			seen.add(next);
			previous.set(next, current);
			if (matches(next, pattern)) return reconstruct(previous, from, next);
			queue.push(next);
		}
	}
	return null;
}

function checkMember(graph: DependencyGraph, member: string): Violation[] {
	const rule = RULES[member];
	if (rule === undefined) {
		return [
			{
				from: member,
				forbidden: "(workspace member without a boundary rule)",
				path: [member],
			},
		];
	}
	const violations: Violation[] = [];
	for (const pattern of rule.mustNotReach) {
		const path = findPath(graph, member, pattern);
		if (path) violations.push({ from: member, forbidden: pattern, path });
	}
	for (const direct of graph.edges.get(member) ?? []) {
		for (const pattern of rule.mustNotDependOn) {
			if (matches(direct, pattern)) {
				violations.push({ from: member, forbidden: pattern, path: [member, direct] });
			}
		}
	}
	return violations;
}

export function checkBoundaries(graph: DependencyGraph): Violation[] {
	const violations = graph.members.flatMap((member) => checkMember(graph, member));
	for (const [from, targets] of graph.edges) {
		if (targets.has(ROOT_CRATE)) {
			violations.push({ from, forbidden: ROOT_CRATE, path: [from, ROOT_CRATE] });
		}
	}
	for (const required of Object.keys(RULES)) {
		if (!graph.members.includes(required)) {
			violations.push({
				from: "(workspace)",
				forbidden: `missing member ${required}`,
				path: [required],
			});
		}
	}
	return violations;
}

type MetadataNode = { id: string; deps: { pkg: string }[] };
type MetadataPackage = { id: string; name: string };
type Metadata = {
	packages: MetadataPackage[];
	workspace_members: string[];
	resolve: { nodes: MetadataNode[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMetadataNode(value: unknown): value is MetadataNode {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		Array.isArray(value.deps) &&
		value.deps.every((dep) => isRecord(dep) && typeof dep.pkg === "string")
	);
}

function isMetadataPackage(value: unknown): value is MetadataPackage {
	return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
	return Array.isArray(value) && value.every(guard);
}

export function parseMetadata(value: unknown): Metadata {
	if (
		!isRecord(value) ||
		!isArrayOf(value.packages, isMetadataPackage) ||
		!isStringArray(value.workspace_members) ||
		!isRecord(value.resolve) ||
		!isArrayOf(value.resolve.nodes, isMetadataNode)
	) {
		throw new Error("Unexpected cargo metadata output shape");
	}
	return {
		packages: value.packages,
		workspace_members: value.workspace_members,
		resolve: { nodes: value.resolve.nodes },
	};
}

export function graphFromMetadata(metadata: Metadata): DependencyGraph {
	const names = new Map(metadata.packages.map((pkg) => [pkg.id, pkg.name]));
	const nameOf = (id: string): string => {
		const name = names.get(id);
		if (name === undefined) throw new Error(`Unknown package id in metadata: ${id}`);
		return name;
	};
	const edges = new Map<string, Set<string>>();
	for (const node of metadata.resolve.nodes) {
		const set = edges.get(nameOf(node.id)) ?? new Set<string>();
		for (const dep of node.deps) set.add(nameOf(dep.pkg));
		edges.set(nameOf(node.id), set);
	}
	return { members: metadata.workspace_members.map(nameOf), edges };
}

export function formatViolation(violation: Violation): string {
	return `${violation.from} must not depend on ${violation.forbidden}: ${violation.path.join(" -> ")}`;
}

async function readMetadata(): Promise<unknown> {
	const command = new Deno.Command("cargo", {
		args: ["metadata", "--format-version", "1", "--locked"],
		stdout: "piped",
		stderr: "inherit",
	});
	const output = await command.output();
	if (!output.success) throw new Error(`cargo metadata failed with exit code ${output.code}`);
	return JSON.parse(new TextDecoder().decode(output.stdout));
}

if (import.meta.main) {
	const graph = graphFromMetadata(parseMetadata(await readMetadata()));
	const violations = checkBoundaries(graph);
	if (violations.length > 0) {
		for (const violation of violations) console.error(formatViolation(violation));
		Deno.exit(1);
	}
	console.log(`Rust crate boundaries ok (${graph.members.length} members)`);
}
