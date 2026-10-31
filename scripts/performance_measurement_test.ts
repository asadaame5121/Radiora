// biome-ignore-all lint/style/noMagicNumbers: Sample values and quantiles are the percentile oracle.
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
	MEASUREMENT_CASES,
	nearestRankPercentile,
	parseMeasurementCliOptions,
	runMeasurementCase,
} from "./performance_measurement.ts";

Deno.test("nearestRankPercentile matches analyze_operation_log.py definition", () => {
	// 30 samples 1..30
	const samples = Array.from({ length: 30 }, (_, i) => i + 1);
	assertEquals(nearestRankPercentile(samples, 0.5), 15); // index 14
	assertEquals(nearestRankPercentile(samples, 0.95), 29); // 29th element (index 28)
	assertEquals(nearestRankPercentile(samples, 1.0), 30); // max
	assertEquals(nearestRankPercentile(samples, 0.0), 1); // min
});

Deno.test("parseMeasurementCliOptions parses valid args and rejects invalid or existing paths", async () => {
	const valid = parseMeasurementCliOptions([
		"--case",
		"1k-balanced-move",
		"--seed",
		"42",
		"--output",
		"target/test-output-dir-123",
	]);
	assertEquals(valid.caseId, "1k-balanced-move");
	assertEquals(valid.seed, 42);
	assertEquals(valid.outputDir, "target/test-output-dir-123");

	// Invalid case
	assertThrows(() =>
		parseMeasurementCliOptions(["--case", "non-existent-case", "--output", "target/out"]),
	);

	// Existing output dir rejection
	const tempDir = await Deno.makeTempDir({ prefix: "radiora-measure-exist-" });
	try {
		await assertRejects(
			async () => {
				const opts = parseMeasurementCliOptions([
					"--case",
					"1k-balanced-move",
					"--output",
					tempDir,
				]);
				await opts.validateOutputDir();
			},
			Error,
			"already exists",
		);
	} finally {
		await Deno.remove(tempDir, { recursive: true });
	}
});

Deno.test("runMeasurementCase executes warmup + measurement trials in isolated DBs and records stats", async () => {
	const tempOutputDir = await Deno.makeTempDir({ prefix: "radiora-measure-test-" });
	const outputDir = `${tempOutputDir}/run-1`;

	try {
		// Run small 2 warmup + 3 measurement trial count
		const result = await runMeasurementCase({
			caseId: "1k-balanced-move",
			seed: 42,
			outputDir,
			warmupCount: 2,
			measurementCount: 3,
		});

		assertEquals(result.caseId, "1k-balanced-move");
		assertEquals(result.seed, 42);
		assertEquals(result.trials.warmup.length, 2);
		assertEquals(result.trials.samples.length, 3);
		assertEquals(result.stats.min <= result.stats.median, true);
		assertEquals(result.stats.median <= result.stats.p95, true);
		assertEquals(result.stats.p95 <= result.stats.max, true);
		assertEquals(result.counters.transaction > 0, true);
		assertEquals(result.counters.sql > 0, true);
		assertEquals(result.environment.runtime.startsWith("deno "), true);
		assertEquals(result.heap, null);
		assertEquals(result.success, true);

		// Output file was written
		const writtenJson = JSON.parse(await Deno.readTextFile(`${outputDir}/result.json`));
		assertEquals(writtenJson.caseId, "1k-balanced-move");
		assertEquals(writtenJson.stats.max, result.stats.max);
	} finally {
		await Deno.remove(tempOutputDir, { recursive: true });
	}
});

Deno.test("runMeasurementCase propagates faults and does not mask failures", async () => {
	const tempOutputDir = await Deno.makeTempDir({ prefix: "radiora-measure-fail-" });
	const outputDir = `${tempOutputDir}/run-fail`;

	try {
		await assertRejects(
			async () => {
				await runMeasurementCase({
					caseId: "1k-balanced-move",
					seed: 42,
					outputDir,
					warmupCount: 1,
					measurementCount: 1,
					faultInjector: () => {
						throw new Error("injected SQL/disk fault");
					},
				});
			},
			Error,
			"injected SQL/disk fault",
		);
	} finally {
		await Deno.remove(tempOutputDir, { recursive: true });
	}
});
