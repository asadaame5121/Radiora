import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { createPerformanceFixture as generatePerformanceFixture } from "./performance_fixture/generator.ts";
import { validatePerformanceFixture as checkPerformanceFixture } from "./performance_fixture/manifest.ts";
import { parseProfile, parseSeed, parseTopicCount } from "./performance_fixture/model.ts";
import type { PerformanceFixture, PerformanceFixtureOptions } from "./performance_fixture/model.ts";

export {
	PERFORMANCE_FIXTURE_PROFILES,
	PERFORMANCE_TOPIC_COUNTS,
} from "./performance_fixture/model.ts";
export type {
	PerformanceFixture,
	PerformanceFixtureManifest,
	PerformanceFixtureOptions,
	PerformanceFixtureProfile,
	PerformanceTopicCount,
} from "./performance_fixture/model.ts";

interface CliOptions extends PerformanceFixtureOptions {
	outputPath?: string;
	databasePath?: string;
	manifestPath?: string;
	validatePath?: string;
}

export function createPerformanceFixture(input: PerformanceFixtureOptions): PerformanceFixture {
	return generatePerformanceFixture(input);
}

export function validatePerformanceFixture(value: unknown): PerformanceFixture {
	return checkPerformanceFixture(value);
}

export async function writePerformanceDatabase(
	path: string,
	state: GraphStateSnapshot,
): Promise<number> {
	await assertFileDoesNotExist(path);
	await makeParentDirectory(path);
	const store = new SqliteGraphStore(path);
	try {
		await store.initialize();
		await store.restoreGraphState(state);
	} finally {
		await store.close();
	}
	return (await Deno.stat(path)).size;
}

async function runCli(args: string[]): Promise<void> {
	const options = parseCliOptions(args);
	if (options.validatePath) {
		const input: unknown = JSON.parse(await Deno.readTextFile(options.validatePath));
		console.log(JSON.stringify(validatePerformanceFixture(input).manifest, null, 2));
		return;
	}
	const outputs = [options.outputPath, options.databasePath, options.manifestPath].filter(
		(path): path is string => path !== undefined,
	);
	await Promise.all(outputs.map(assertFileDoesNotExist));
	const generationStarted = performance.now();
	const fixture = createPerformanceFixture(options);
	const generationMs = performance.now() - generationStarted;
	let databaseBytes: number | null = null;
	let databaseSeedMs: number | null = null;
	if (options.databasePath) {
		const started = performance.now();
		databaseBytes = await writePerformanceDatabase(options.databasePath, fixture.state);
		databaseSeedMs = performance.now() - started;
	}
	if (options.outputPath) {
		await writeNewJsonFile(options.outputPath, fixture);
	}
	const manifestPath = options.manifestPath;
	if (manifestPath) await writeNewJsonFile(manifestPath, fixture.manifest);
	console.log(
		JSON.stringify(
			{
				manifest: fixture.manifest,
				generationMs: roundMs(generationMs),
				databaseSeedMs: databaseSeedMs === null ? null : roundMs(databaseSeedMs),
				databaseBytes,
				databasePath: options.databasePath ?? null,
				outputPath: options.outputPath ?? null,
				manifestPath: options.manifestPath ?? null,
			},
			null,
			2,
		),
	);
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = { profile: "baseline", topicCount: 1_000, seed: 42 };
	for (let index = 0; index < args.length; index += 1) {
		const [flag, inlineValue] = args[index].split("=", 2);
		const value = inlineValue ?? args[++index];
		if (flag === "--help" || flag === "-h") {
			printHelp();
			Deno.exit(0);
		}
		if (!value) throw new Error(`Missing value for ${flag}`);
		applyPerformanceFixtureOption(options, flag, value);
	}
	validateCliOptions(options);
	return options;
}

function applyPerformanceFixtureOption(options: CliOptions, flag: string, value: string): void {
	switch (flag) {
		case "--profile":
			options.profile = parseProfile(value);
			break;
		case "--topic-count":
			options.topicCount = parseTopicCount(Number(value));
			break;
		case "--seed":
			options.seed = parseSeed(Number(value));
			break;
		case "--output":
			options.outputPath = value;
			break;
		case "--database":
			options.databasePath = value;
			break;
		case "--manifest":
			options.manifestPath = value;
			break;
		case "--validate":
			options.validatePath = value;
			break;
		default:
			throw new Error(`Unknown option: ${flag}`);
	}
}

function validateCliOptions(options: CliOptions): void {
	if (
		options.validatePath &&
		(options.outputPath || options.databasePath || options.manifestPath)
	) {
		throw new Error("--validate cannot be combined with output, database, or manifest paths.");
	}
	if (!options.validatePath && !options.outputPath && !options.databasePath) {
		throw new Error("Specify --output and/or --database for generated data.");
	}
	if (!options.validatePath && !options.manifestPath) {
		const primaryPath = options.databasePath ?? options.outputPath;
		if (!primaryPath) throw new Error("Specify --output and/or --database for generated data.");
		options.manifestPath = `${primaryPath}.manifest.json`;
	}
	const destinations = [options.outputPath, options.databasePath, options.manifestPath].filter(
		(path): path is string => path !== undefined,
	);
	if (new Set(destinations).size !== destinations.length) {
		throw new Error("Output, database, and manifest paths must be different.");
	}
}

async function writeNewJsonFile(path: string, value: unknown): Promise<void> {
	await assertFileDoesNotExist(path);
	await makeParentDirectory(path);
	await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, { createNew: true });
}

async function assertFileDoesNotExist(path: string): Promise<void> {
	try {
		await Deno.lstat(path);
		throw new Error(`Refusing to replace existing performance output: ${path}`);
	} catch (cause) {
		if (!(cause instanceof Deno.errors.NotFound)) throw cause;
	}
}

async function makeParentDirectory(path: string): Promise<void> {
	const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (separator > 0) await Deno.mkdir(path.slice(0, separator), { recursive: true });
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function printHelp(): void {
	console.log(`Usage: deno task performance:fixture --options

Options:
  --profile <name>          baseline|deep-tree|dense-links|wide-tree|combined (default: baseline)
  --topic-count <count>     1000|10000 (default: 1000)
  --seed <number>           Unsigned 32-bit seed (default: 42)
  --output <path>           Write the fixture envelope as JSON
  --database <path>         Seed a new isolated SQLite database (must not exist)
  --manifest <path>         Write the deterministic manifest as JSON
  --validate <path>         Validate a fixture envelope and print its measured manifest
  --help                    Show this help
`);
}

if (import.meta.main) {
	try {
		await runCli(Deno.args);
	} catch (cause) {
		console.error(
			`Performance fixture failed: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		Deno.exit(1);
	}
}
