import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import {
	createCountingSqliteConnector,
	createPerformanceCounters,
	instrumentStore,
	type PerformanceCounterSnapshot,
} from "../tests/support/performance_counters.ts";
import {
	type AcceptanceFixtureManifest,
	createAcceptanceFixture,
} from "./performance_fixture/acceptance.ts";
import { writePerformanceDatabase } from "./performance_fixture.ts";
import {
	MEASUREMENT_CASES,
	type MeasurementCaseDefinition,
} from "./performance_measurement_cases.ts";

export { MEASUREMENT_CASES, type MeasurementCaseDefinition };

const DEFAULT_MEASUREMENT_SEED = 42;
const DEFAULT_WARMUP_COUNT = 5;
const DEFAULT_MEASUREMENT_COUNT = 30;
const MEDIAN_QUANTILE = 0.5;
const P95_QUANTILE = 0.95;

export function nearestRankPercentile(sortedValues: number[], quantile: number): number {
	if (sortedValues.length === 0) return 0;
	const rank = Math.max(0, Math.ceil(quantile * sortedValues.length) - 1);
	return sortedValues[rank];
}

export interface MeasurementResult {
	caseId: string;
	seed: number;
	manifest: AcceptanceFixtureManifest;
	trials: {
		warmup: number[];
		samples: number[];
	};
	stats: {
		min: number;
		median: number;
		p95: number;
		max: number;
	};
	counters: PerformanceCounterSnapshot;
	queueWaitMs: number | null;
	environment: {
		runtime: string;
		os: string;
		arch: string;
		cpuCount: number;
		commit: string;
	};
	heap: null;
	heapReason: string;
	success: boolean;
}

export interface RunMeasurementOptions {
	caseId: string;
	seed?: number;
	outputDir: string;
	warmupCount?: number;
	measurementCount?: number;
	faultInjector?: () => void;
}

async function ensureOutputPathAbsent(outputDir: string): Promise<void> {
	try {
		await Deno.stat(outputDir);
		throw new Error(`Output path already exists: ${outputDir}`);
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) {
			throw error;
		}
	}
}

async function runMeasurementTrial(
	caseDef: MeasurementCaseDefinition,
	state: GraphStateSnapshot,
	isWarmup: boolean,
	faultInjector?: () => void,
): Promise<{ duration: number; counters: PerformanceCounterSnapshot | null }> {
	const trialDir = await Deno.makeTempDir({ prefix: "radiora-measure-trial-" });
	const dbPath = `${trialDir}/fixture.db`;
	let duration = 0;
	let countersSnapshot: PerformanceCounterSnapshot | null = null;
	try {
		await writePerformanceDatabase(dbPath, state);
		const counters = createPerformanceCounters();
		const store = new SqliteGraphStore(dbPath, {
			connector: createCountingSqliteConnector(counters),
		});
		instrumentStore(store, counters);
		try {
			await store.initialize();
			counters.reset();
			faultInjector?.();
			const start = performance.now();
			await caseDef.action(store, state);
			duration = performance.now() - start;
			if (!isWarmup) countersSnapshot = counters.snapshot();
		} finally {
			await store.close();
		}
	} finally {
		try {
			await Deno.remove(trialDir, { recursive: true });
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) {
				console.error(`Could not remove measurement trial directory ${trialDir}`, cause);
			}
		}
	}
	return { duration, counters: countersSnapshot };
}

async function runMeasurementTrials(
	caseDef: MeasurementCaseDefinition,
	state: GraphStateSnapshot,
	warmupCount: number,
	measurementCount: number,
	faultInjector?: () => void,
): Promise<{
	warmup: number[];
	samples: number[];
	counters: PerformanceCounterSnapshot | null;
}> {
	const warmup: number[] = [];
	const samples: number[] = [];
	let counters: PerformanceCounterSnapshot | null = null;
	for (let trial = 0; trial < warmupCount + measurementCount; trial++) {
		const isWarmup = trial < warmupCount;
		const outcome = await runMeasurementTrial(caseDef, state, isWarmup, faultInjector);
		if (isWarmup) warmup.push(outcome.duration);
		else {
			samples.push(outcome.duration);
			counters = outcome.counters;
		}
	}
	return { warmup, samples, counters };
}

async function readCommitHash(): Promise<string> {
	const gitCmd = new Deno.Command("git", { args: ["rev-parse", "HEAD"] });
	const gitResult = await gitCmd.output();
	if (!gitResult.success) {
		const reason = new TextDecoder().decode(gitResult.stderr).trim();
		throw new Error(`Unable to determine Git HEAD for measurement: ${reason}`);
	}
	return new TextDecoder().decode(gitResult.stdout).trim();
}

function buildMeasurementResult(
	caseId: string,
	seed: number,
	manifest: AcceptanceFixtureManifest,
	trials: Awaited<ReturnType<typeof runMeasurementTrials>>,
	commitHash: string,
): MeasurementResult {
	const sortedSamples = [...trials.samples].sort((a, b) => a - b);
	const zeroCounters = createPerformanceCounters().snapshot();
	return {
		caseId,
		seed,
		manifest,
		trials: {
			warmup: trials.warmup,
			samples: trials.samples,
		},
		stats: {
			min: sortedSamples[0] ?? 0,
			median: nearestRankPercentile(sortedSamples, MEDIAN_QUANTILE),
			p95: nearestRankPercentile(sortedSamples, P95_QUANTILE),
			max: sortedSamples[sortedSamples.length - 1] ?? 0,
		},
		counters: trials.counters ?? zeroCounters,
		queueWaitMs: null,
		environment: {
			runtime: `deno ${Deno.version.deno}`,
			os: Deno.build.os,
			arch: Deno.build.arch,
			cpuCount: navigator.hardwareConcurrency ?? 1,
			commit: commitHash,
		},
		heap: null,
		heapReason: "Deno memory measurement not available in current runtime",
		success: true,
	};
}

export async function runMeasurementCase(
	options: RunMeasurementOptions,
): Promise<MeasurementResult> {
	const caseDef = MEASUREMENT_CASES.find((c) => c.id === options.caseId);
	if (!caseDef) throw new Error(`Unknown measurement case: ${options.caseId}`);
	const seed = options.seed ?? DEFAULT_MEASUREMENT_SEED;
	const warmupCount = options.warmupCount ?? DEFAULT_WARMUP_COUNT;
	const measurementCount = options.measurementCount ?? DEFAULT_MEASUREMENT_COUNT;
	await ensureOutputPathAbsent(options.outputDir);
	const fixture = createAcceptanceFixture({ ...caseDef.options, seed });
	const trials = await runMeasurementTrials(
		caseDef,
		fixture.state,
		warmupCount,
		measurementCount,
		options.faultInjector,
	);
	const result = buildMeasurementResult(
		options.caseId,
		seed,
		fixture.manifest,
		trials,
		await readCommitHash(),
	);

	await Deno.mkdir(options.outputDir, { recursive: true });
	await Deno.writeTextFile(
		`${options.outputDir}/result.json`,
		JSON.stringify(result, null, 2),
	);

	return result;
}

export interface MeasurementCliOptions {
	caseId: string;
	seed: number;
	outputDir: string;
	validateOutputDir: () => Promise<void>;
}

export function parseMeasurementCliOptions(args: string[]): MeasurementCliOptions {
	let caseId: string | undefined;
	let seed = DEFAULT_MEASUREMENT_SEED;
	let outputDir: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--case") {
			caseId = args[++i];
		} else if (arg === "--seed") {
			seed = Number.parseInt(args[++i], 10);
		} else if (arg === "--output") {
			outputDir = args[++i];
		}
	}

	if (!caseId) {
		throw new Error("Missing required argument: --case <id>");
	}
	if (!outputDir) {
		throw new Error("Missing required argument: --output <dir>");
	}

	const caseDef = MEASUREMENT_CASES.find((c) => c.id === caseId);
	if (!caseDef) {
		throw new Error(`Unknown measurement case: ${caseId}`);
	}

	if (!Number.isSafeInteger(seed) || seed < 0) {
		throw new Error(`Invalid seed: ${seed}`);
	}

	const out = outputDir;
	return {
		caseId,
		seed,
		outputDir: out,
		validateOutputDir: async () => {
			await ensureOutputPathAbsent(out);
		},
	};
}

if (import.meta.main) {
	try {
		const cliOpts = parseMeasurementCliOptions(Deno.args);
		await cliOpts.validateOutputDir();
		console.log(`Running measurement case '${cliOpts.caseId}' with seed ${cliOpts.seed}...`);
		const result = await runMeasurementCase({
			caseId: cliOpts.caseId,
			seed: cliOpts.seed,
			outputDir: cliOpts.outputDir,
		});
		console.log(
			`Done. Median: ${result.stats.median.toFixed(2)}ms, p95: ${
				result.stats.p95.toFixed(2)
			}ms, max: ${result.stats.max.toFixed(2)}ms`,
		);
	} catch (error) {
		console.error("Measurement failed:", error);
		Deno.exit(1);
	}
}
