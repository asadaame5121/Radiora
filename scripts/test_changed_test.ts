import {
	changedFiles as readChanges,
	runPlan,
	selectTests,
	splitGitPaths,
	vitestTestCount,
} from "./test_changed.ts";

async function changedFiles(cwd: string, mode: "changed" | "staged"): Promise<string[]> {
	return (await readChanges(cwd, mode)).files;
}

function resolve(cwd: string, file: string): string {
	return `${cwd}/${file}`;
}

function assertEquals(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

const inventory = [
	"src/ui/theme_controller.svelte.ts",
	"src/ui/ThemeView.svelte",
	"vitest/theme_controller.svelte.test.ts",
	"src/services/parser.ts",
	"src/services/parser_test.ts",
	"src/domain/model.ts",
	"tests/nested/model_test.ts",
	"scripts/tool.ts",
	"scripts/tool_test.ts",
];

Deno.test("UI and controller changes use Vitest related paths, not Deno", () => {
	assertEquals(
		selectTests([
			"src/ui/theme_controller.svelte.ts",
			"src/ui/ThemeView.svelte",
		], inventory),
		{
			deno: [],
			vitest: ["src/ui/ThemeView.svelte", "src/ui/theme_controller.svelte.ts"],
			denoFallback: false,
			vitestFallback: false,
		},
	);
});

Deno.test("Deno chooses colocated and nested tests by exact basename", () => {
	assertEquals(
		selectTests([
			"src/services/parser.ts",
			"src/domain/model.ts",
			"scripts/tool.ts",
		], inventory),
		{
			deno: ["scripts/tool_test.ts", "src/services/parser_test.ts", "tests/nested/model_test.ts"],
			vitest: [],
			denoFallback: false,
			vitestFallback: false,
		},
	);
});

Deno.test("modified test files select themselves and deduplicate", () => {
	assertEquals(
		selectTests([
			"src/services/parser.ts",
			"src/services/parser_test.ts",
			"vitest/theme_controller.svelte.test.ts",
		], inventory),
		{
			deno: ["src/services/parser_test.ts"],
			vitest: ["vitest/theme_controller.svelte.test.ts"],
			denoFallback: false,
			vitestFallback: false,
		},
	);
});

Deno.test("shared unmapped modules and deleted Deno tests fall back", () => {
	for (const file of ["src/domain/shared.ts", "src/services/deleted_test.ts"]) {
		assertEquals(selectTests([file], [...inventory, "src/domain/shared.ts"]), {
			deno: ["src", "tests", "scripts"],
			vitest: [],
			denoFallback: true,
			vitestFallback: false,
		});
	}
});

Deno.test("deleted and renamed UI files run all unit tests", () => {
	assertEquals(
		selectTests([
			"src/ui/OldView.svelte",
			"src/ui/ThemeView.svelte",
		], inventory).vitestFallback,
		true,
	);
	assertEquals(selectTests(["vitest/deleted.test.ts"], inventory).vitestFallback, true);
});

Deno.test("config, dependencies, assets and unknown changes fall back to both suites", () => {
	for (
		const file of [
			"deno.json",
			"package-lock.json",
			"vite.config.ts",
			"src/main.ts",
			"public/icon.svg",
			"stories/App.stories.svelte",
			"tests/fixtures/data.json",
		]
	) {
		const plan = selectTests([file], inventory);
		assertEquals(plan.denoFallback, true);
		// src/main.ts is a Deno entry point; root config and assets affect both runners.
		assertEquals(plan.vitestFallback, file !== "src/main.ts");
	}
});

Deno.test("empty and documentation-only changes need no tests", () => {
	const empty = { deno: [], vitest: [], denoFallback: false, vitestFallback: false };
	assertEquals(selectTests([], inventory), empty);
	assertEquals(selectTests(["README.md", "docs/design/foo.md"], inventory), empty);
});

Deno.test("Windows paths normalize and NUL parsing preserves spaces and newlines", () => {
	assertEquals(selectTests(["src\\services\\parser.ts"], inventory).deno, [
		"src/services/parser_test.ts",
	]);
	assertEquals(splitGitPaths("src/a b.ts\0src/日本語.ts\0src/a\nb.ts\0"), [
		"src/a b.ts",
		"src/日本語.ts",
		"src/a\nb.ts",
	]);
});

Deno.test("Vitest report rejects malformed counts", () => {
	const testCount = 4;
	assertEquals(vitestTestCount({ numTotalTests: 0 }), 0);
	assertEquals(vitestTestCount({ numTotalTests: testCount }), testCount);
	for (const report of [null, {}, { numTotalTests: "4" }, { numTotalTests: -1 }]) {
		let rejected = false;
		try {
			vitestTestCount(report);
		} catch {
			rejected = true;
		}
		assertEquals(rejected, true);
	}
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	const output = await new Deno.Command("git", {
		cwd,
		args,
		stdout: "piped",
		stderr: "piped",
	}).output();
	if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
}

Deno.test("real Git distinguishes staged, unstaged, untracked, rename and delete", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		await git(cwd, "init", "--quiet");
		await git(cwd, "config", "user.email", "test@example.invalid");
		await git(cwd, "config", "user.name", "Test");
		for (const file of ["staged.ts", "working.ts", "old name.ts", "delete.ts"]) {
			await Deno.writeTextFile(resolve(cwd, file), "original\n");
		}
		await git(cwd, "add", ".");
		await git(
			cwd,
			"-c",
			"core.hooksPath=",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"initial",
		);
		assertEquals(await changedFiles(cwd, "changed"), []);
		await Deno.writeTextFile(resolve(cwd, "staged.ts"), "staged\n");
		await git(cwd, "add", "staged.ts");
		await Deno.writeTextFile(resolve(cwd, "working.ts"), "working\n");
		await Deno.writeTextFile(resolve(cwd, "untracked 日本語.ts"), "new\n");
		await git(cwd, "mv", "old name.ts", "new name.ts");
		await git(cwd, "rm", "delete.ts");
		assertEquals(await changedFiles(cwd, "staged"), [
			"delete.ts",
			"new name.ts",
			"old name.ts",
			"staged.ts",
		]);
		assertEquals(await changedFiles(cwd, "changed"), [
			"delete.ts",
			"new name.ts",
			"old name.ts",
			"staged.ts",
			"untracked 日本語.ts",
			"working.ts",
		]);
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});

Deno.test("Git detection works before the first commit", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		await git(cwd, "init", "--quiet");
		await Deno.writeTextFile(resolve(cwd, "new.ts"), "new\n");
		assertEquals(await changedFiles(cwd, "changed"), ["new.ts"]);
		assertEquals(await changedFiles(cwd, "staged"), []);
		await git(cwd, "add", "new.ts");
		assertEquals(await changedFiles(cwd, "staged"), ["new.ts"]);
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});

Deno.test("staged deletion remains a deletion after unstaged recreation", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		await git(cwd, "init", "--quiet");
		await Deno.mkdir(`${cwd}/src/ui`, { recursive: true });
		const files = ["src/ui/View.svelte", "src/example_test.ts"];
		for (const file of files) await Deno.writeTextFile(`${cwd}/${file}`, "original\n");
		await git(cwd, "add", ".");
		await git(
			cwd,
			"-c",
			"core.hooksPath=",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"-qm",
			"initial",
		);
		await git(cwd, "rm", ...files);
		await Deno.mkdir(`${cwd}/src/ui`, { recursive: true });
		for (const file of files) await Deno.writeTextFile(`${cwd}/${file}`, "recreated\n");
		for (const mode of ["changed", "staged"] as const) {
			const changes = await readChanges(cwd, mode);
			assertEquals(changes.deleted, [...files].sort());
			const plan = selectTests(changes.files, files, changes.deleted);
			assertEquals(plan.denoFallback, true);
			assertEquals(plan.vitestFallback, true);
		}
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});

Deno.test("selected Deno test failures propagate", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(
			resolve(cwd, "broken_test.ts"),
			'Deno.test("broken", () => { throw new Error("expected failure"); });\n',
		);
		const code = await runPlan(cwd, {
			deno: ["broken_test.ts"],
			vitest: [],
			denoFallback: false,
			vitestFallback: false,
		});
		assertEquals(code !== 0, true);
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});

Deno.test("Deno fallback executes tests in every configured root", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		for (const root of ["src", "tests", "scripts"]) {
			await Deno.mkdir(`${cwd}/${root}`);
			await Deno.writeTextFile(
				`${cwd}/${root}/example_test.ts`,
				`Deno.test("${root}", () => Deno.writeTextFileSync("${root}.ran", "ok"));\n`,
			);
		}
		assertEquals(await runPlan(cwd, selectTests(["src/shared.ts"], [])), 0);
		for (const root of ["src", "tests", "scripts"]) {
			assertEquals(await Deno.readTextFile(`${cwd}/${root}.ran`), "ok");
		}
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});

Deno.test("zero-test Deno selection falls back and an empty fallback fails", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		for (const root of ["src", "tests", "scripts"]) await Deno.mkdir(`${cwd}/${root}`);
		await Deno.writeTextFile(`${cwd}/src/empty_test.ts`, "// no registered tests\n");
		const plan = selectTests(["src/empty_test.ts"], ["src/empty_test.ts"]);
		await Deno.writeTextFile(
			`${cwd}/tests/live_test.ts`,
			'Deno.test("fallback", () => Deno.writeTextFileSync("fallback.ran", "ok"));\n',
		);
		assertEquals(await runPlan(cwd, plan), 0);
		assertEquals(await Deno.readTextFile(`${cwd}/fallback.ran`), "ok");
		await Deno.remove(`${cwd}/tests/live_test.ts`);
		let rejected = false;
		try {
			await runPlan(cwd, plan);
		} catch (error) {
			rejected = error instanceof Error && error.message === "Deno fallback selected no tests";
		}
		assertEquals(rejected, true);
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});

async function vitestFixture(cwd: string, scenario: string): Promise<void> {
	await Deno.mkdir(`${cwd}/node_modules/vitest`, { recursive: true });
	// A subprocess fixture tests CLI orchestration without running the real unit suite
	// again inside every `deno task test`. Real related selection is checked separately.
	await Deno.writeTextFile(
		`${cwd}/node_modules/vitest/vitest.mjs`,
		`import { appendFileSync, writeFileSync } from "node:fs";
const related = process.argv.includes("related");
appendFileSync("calls.txt", related ? "related\\n" : "full\\n");
const scenario = ${JSON.stringify(scenario)};
if (scenario === "failure") process.exit(2);
const report = process.argv.find(arg => arg.startsWith("--outputFile.json=")).slice("--outputFile.json=".length);
writeFileSync(report, scenario === "invalid" ? "{}" : JSON.stringify({
  numTotalTests: scenario === "empty" || (scenario === "fallback" && related) ? 0 : 4
}));
`,
	);
}

Deno.test("Vitest CLI runs related tests and falls back only for a valid zero count", async () => {
	for (const scenario of ["related", "fallback", "failure", "invalid", "empty"]) {
		const cwd = await Deno.makeTempDir();
		try {
			await vitestFixture(cwd, scenario);
			let code: number | undefined;
			let rejected = false;
			try {
				code = await runPlan(cwd, {
					deno: [],
					vitest: ["src/ui/example.svelte.ts"],
					denoFallback: false,
					vitestFallback: false,
				});
			} catch {
				rejected = true;
			}
			const fallback = scenario === "fallback" || scenario === "empty";
			assertEquals(
				await Deno.readTextFile(`${cwd}/calls.txt`),
				fallback ? "related\nfull\n" : "related\n",
			);
			assertEquals(rejected, scenario === "invalid" || scenario === "empty");
			if (!rejected) assertEquals(code, scenario === "failure" ? 2 : 0);
		} finally {
			await Deno.remove(cwd, { recursive: true });
		}
	}
});

Deno.test("real Vitest related selects a Svelte View/Controller suite, not an unrelated suite", async () => {
	const cwd = await Deno.makeTempDir();
	try {
		await Deno.symlink(new URL("../node_modules", import.meta.url), `${cwd}/node_modules`, {
			type: Deno.build.os === "windows" ? "junction" : "dir",
		});
		await Deno.writeTextFile(`${cwd}/package.json`, '{"type":"module"}');
		await Deno.writeTextFile(
			`${cwd}/vitest.unit.config.ts`,
			`
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ["browser"] },
  test: { name: "unit", include: ["vitest/**/*.test.ts"] }
});
`,
		);
		await Deno.mkdir(`${cwd}/src/ui`, { recursive: true });
		await Deno.mkdir(`${cwd}/vitest`);
		await Deno.writeTextFile(
			`${cwd}/src/ui/counter.svelte.ts`,
			"export function counter() { let value = $state(0); return { get value() { return value; } }; }",
		);
		await Deno.writeTextFile(`${cwd}/src/ui/View.svelte`, "<p>Example</p>");
		await Deno.writeTextFile(
			`${cwd}/vitest/counter.test.ts`,
			`
import { test, expect } from "vitest";
import { counter } from "../src/ui/counter.svelte.ts";
import View from "../src/ui/View.svelte";
test("related", () => { expect(counter().value).toBe(0); expect(View).toBeDefined(); });
`,
		);
		await Deno.writeTextFile(
			`${cwd}/vitest/unrelated.test.ts`,
			`
import { test } from "vitest";
test("must not run", () => { throw new Error("unrelated suite selected"); });
`,
		);
		const changed = ["src/ui/counter.svelte.ts", "src/ui/View.svelte"];
		assertEquals(await runPlan(cwd, selectTests(changed, changed)), 0);
	} finally {
		await Deno.remove(cwd, { recursive: true });
	}
});
