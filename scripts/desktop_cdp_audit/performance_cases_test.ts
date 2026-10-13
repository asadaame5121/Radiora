import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	buildPerformanceCaseExpression,
	parsePerformanceCaseArguments,
} from "./performance_cases.ts";

Deno.test("performance case arguments keep CDP options and select a supported case", () => {
	assertEquals(
		parsePerformanceCaseArguments([
			"--case=tree-pan",
			"--item-id",
			"item-1",
			"--trace",
			"trace.json",
			"--output",
			"report.json",
		]),
		{
			caseName: "tree-pan",
			itemId: "item-1",
			auditArgs: ["--trace", "trace.json", "--output", "report.json"],
		},
	);
	assertThrows(() => parsePerformanceCaseArguments(["--case", "unknown"]));
});

Deno.test("renderer case records explicit markers and labels rAF as a proxy", () => {
	const expression = buildPerformanceCaseExpression("outline-input", `quote"\nitem`);
	assert(expression.includes("radiora:"));
	assert(expression.includes("raf-proxy"));
	assert(expression.includes("synthetic renderer DOM event"));
	assert(expression.includes("not paint completion"));
	assert(expression.includes('quote\\"\\nitem'));
});
