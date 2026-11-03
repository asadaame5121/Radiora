/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ["@stryker-mutator/vitest-runner"],
	testRunner: "vitest",
	vitest: { configFile: "vitest.unit.config.ts", related: true },
	concurrency: 2,
	dryRunTimeoutMinutes: 15,
	mutate: ["src/ui/tree_camera.ts", "src/ui/tree_layout.ts", "src/ui/tree_spatial_index.ts"],
	reporters: ["clear-text", "html", "json"],
	htmlReporter: { fileName: "reports/mutation/tree.html" },
	jsonReporter: { fileName: "reports/mutation/tree.json" },
	incremental: true,
	incrementalFile: "reports/mutation/tree-incremental.json",
	thresholds: { high: 80, low: 60, break: 0 },
};

export default config;
