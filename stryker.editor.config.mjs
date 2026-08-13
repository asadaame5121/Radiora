import controllerConfig from "./stryker.config.mjs";

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	...controllerConfig,
	mutate: ["src/ui/editor_controller.svelte.ts"],
	htmlReporter: { fileName: "reports/mutation/editor.html" },
	jsonReporter: { fileName: "reports/mutation/editor.json" },
	incrementalFile: "reports/mutation/editor-incremental.json",
};

export default config;
