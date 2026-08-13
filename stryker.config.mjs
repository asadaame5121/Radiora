/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	testRunner: "vitest",
	vitest: { configFile: "vitest.stryker.config.ts", related: true },
	concurrency: 2,
	dryRunTimeoutMinutes: 15,
	mutate: ["src/ui/*_controller.svelte.ts"],
	reporters: ["clear-text", "html", "json"],
	htmlReporter: { fileName: "reports/mutation/controllers.html" },
	jsonReporter: { fileName: "reports/mutation/controllers.json" },
	incremental: true,
	incrementalFile: "reports/mutation/controllers-incremental.json",
	thresholds: { high: 80, low: 60, break: 0 },
};

export default config;
