export function denoMutationBatch(name, mutate, tests) {
	return {
		testRunner: "command",
		commandRunner: { command: `deno test -A ${tests.join(" ")}` },
		coverageAnalysis: "off",
		// Keep weekly jobs predictable on shared CI runners instead of scaling to every core.
		concurrency: 2,
		dryRunTimeoutMinutes: 15,
		mutate,
		reporters: ["clear-text", "html", "json"],
		htmlReporter: { fileName: `reports/mutation/${name}.html` },
		jsonReporter: { fileName: `reports/mutation/${name}.json` },
		incremental: true,
		incrementalFile: `reports/mutation/${name}-incremental.json`,
		thresholds: { high: 80, low: 60, break: 0 },
		ignorePatterns: ["dist", "dist-desktop", "storybook-static", "coverage", "output"],
	};
}
