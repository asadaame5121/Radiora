type Coverage = { lines: number; branches: number };
type Baseline = { unit: Coverage; deno: Coverage };
type VitestSummary = {
	total: { lines: { pct: number }; branches: { pct: number } };
};

const BASELINE_URL = new URL("./coverage_baseline.json", import.meta.url);
const TOLERANCE = 0.1;
const UPDATE = Deno.args.includes("--update");

function percentage(covered: number, total: number): number {
	return total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100;
}

async function vitestCoverage(): Promise<Coverage> {
	const report = JSON.parse(
		await Deno.readTextFile("coverage/coverage-summary.json"),
	) as VitestSummary;
	return { lines: report.total.lines.pct, branches: report.total.branches.pct };
}

async function denoCoverage(): Promise<Coverage> {
	const lcov = await Deno.readTextFile("reports/coverage/deno.lcov");
	let linesFound = 0;
	let linesHit = 0;
	let branchesFound = 0;
	let branchesHit = 0;
	for (const line of lcov.split(/\r?\n/)) {
		const [key, raw] = line.split(":", 2);
		const value = Number(raw);
		if (key === "LF") linesFound += value;
		else if (key === "LH") linesHit += value;
		else if (key === "BRF") branchesFound += value;
		else if (key === "BRH") branchesHit += value;
	}
	return {
		lines: percentage(linesHit, linesFound),
		branches: percentage(branchesHit, branchesFound),
	};
}

const current: Baseline = { unit: await vitestCoverage(), deno: await denoCoverage() };
if (UPDATE) {
	await Deno.writeTextFile(BASELINE_URL, `${JSON.stringify(current, null, "\t")}\n`);
	console.log(`Recorded coverage baseline: ${JSON.stringify(current)}`);
} else {
	const baseline = JSON.parse(await Deno.readTextFile(BASELINE_URL)) as Baseline;
	let failed = false;
	for (const suite of ["unit", "deno"] as const) {
		for (const metric of ["lines", "branches"] as const) {
			const minimum = baseline[suite][metric] - TOLERANCE;
			if (current[suite][metric] < minimum) {
				console.error(
					`${suite} ${metric} coverage regressed: ${current[suite][metric]} < ${
						minimum.toFixed(2)
					}`,
				);
				failed = true;
			}
		}
	}
	if (failed) Deno.exit(1);
	console.log(`Coverage ratchet passed: ${JSON.stringify(current)}`);
}
