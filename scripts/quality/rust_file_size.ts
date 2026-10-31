// Rust production file-size ratchet (docs/design/v3-quality-gates.md section 4).
// Counts non-blank physical lines (comments and same-file tests included) and rejects files over
// the limit unless an explicit baseline records them; a baselined file may never grow.
// Excluded: independent tests/benches/examples, generated and vendored code.

export const RUST_FILE_LIMIT = 600;

const BASELINE_URL = new URL("./rust_file_size_baseline.json", import.meta.url);

export type SizeViolation = { path: string; lines: number; allowed: number };

export function countNonBlankLines(source: string): number {
	return source.split(/\r?\n/).filter((line) => line.trim() !== "").length;
}

export function isProductionRust(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	if (!normalized.endsWith(".rs")) return false;
	const excludedSegment = /(^|\/)(tests|benches|examples|vendor|generated|target)\//;
	return !excludedSegment.test(normalized);
}

export function findSizeViolations(
	files: ReadonlyMap<string, string>,
	baseline: Readonly<Record<string, number>>,
	limit = RUST_FILE_LIMIT,
): SizeViolation[] {
	const violations: SizeViolation[] = [];
	for (const [path, source] of files) {
		if (!isProductionRust(path)) continue;
		const lines = countNonBlankLines(source);
		const allowed = Math.max(limit, baseline[path] ?? 0);
		if (lines > allowed) violations.push({ path, lines, allowed });
	}
	return violations;
}

export function parseBaseline(value: unknown): Record<string, number> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Rust file-size baseline must be an object of path -> lines");
	}
	const baseline: Record<string, number> = {};
	for (const [path, lines] of Object.entries(value)) {
		if (typeof lines !== "number" || !Number.isInteger(lines) || lines <= RUST_FILE_LIMIT) {
			throw new Error(`Invalid baseline entry for ${path}: must be an integer over the limit`);
		}
		baseline[path] = lines;
	}
	return baseline;
}

async function* walk(directory: string): AsyncGenerator<string> {
	for await (const entry of Deno.readDir(directory)) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory) yield* walk(path);
		else if (entry.isFile) yield path;
	}
}

async function readCrateSources(): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	for await (const crate of Deno.readDir("crates")) {
		if (!crate.isDirectory) continue;
		for await (const path of walk(`crates/${crate.name}`)) {
			if (isProductionRust(path)) files.set(path, await Deno.readTextFile(path));
		}
	}
	return files;
}

if (import.meta.main) {
	const baseline = parseBaseline(JSON.parse(await Deno.readTextFile(BASELINE_URL)));
	const files = await readCrateSources();
	if (files.size === 0) throw new Error("No production Rust files found under crates/");
	const violations = findSizeViolations(files, baseline);
	for (const v of violations) {
		console.error(`${v.path}: ${v.lines} non-blank lines exceeds ${v.allowed}`);
	}
	if (violations.length > 0) Deno.exit(1);
	console.log(`Rust file size ok (${files.size} files, limit ${RUST_FILE_LIMIT})`);
}
