type Mode = "changed" | "staged";
type GitChanges = { files: string[]; deleted: string[] };
export type TestPlan = {
	deno: string[];
	vitest: string[];
	denoFallback: boolean;
	vitestFallback: boolean;
};

const denoRoots = ["src", "tests", "scripts"];
const decoder = new TextDecoder();

export function splitGitPaths(output: string): string[] {
	return output.split("\0").filter((file) => file !== "");
}

function changeKind(file: string): "documentation" | "vitest" | "deno" | "both" | "all" {
	if (file.endsWith(".md")) return "documentation";
	const ui = file.startsWith("src/ui/") || file.startsWith("vitest/");
	if (ui && !file.endsWith("_test.ts")) {
		if (
			file.endsWith(".svelte") || file.endsWith(".svelte.ts") ||
			file.startsWith("vitest/")
		) return "vitest";
		if (file.endsWith(".ts")) return "both";
	}
	return /^(src|tests|scripts)\/.*\.ts$/.test(file) ? "deno" : "all";
}

function matchingDenoTests(file: string, tests: string[]): string[] {
	if (file.endsWith("_test.ts")) return [file];
	const testName = file.split("/").at(-1)?.replace(/\.ts$/, "_test.ts");
	const colocated = file.replace(/\.ts$/, "_test.ts");
	return tests.filter((test) =>
		test === colocated || (test.startsWith("tests/") && test.split("/").at(-1) === testName)
	);
}

/** Deliberately a naming convention, not a second dependency-graph implementation. */
export function selectTests(
	changed: string[],
	existing: string[],
	deleted: string[] = [],
): TestPlan {
	const removed = new Set(deleted.map((file) => file.replaceAll("\\", "/")));
	const files = new Set(
		existing.map((file) => file.replaceAll("\\", "/")).filter((file) => !removed.has(file)),
	);
	const denoTests = [...files].filter((file) => /^(src|tests|scripts)\/.*_test\.ts$/.test(file));
	const deno = new Set<string>();
	const vitest = new Set<string>();
	let denoFallback = false;
	let vitestFallback = false;
	for (const raw of changed) {
		const file = raw.replaceAll("\\", "/");
		const kind = changeKind(file);
		if (kind === "documentation") continue;
		// Unknown non-doc files fail closed, including config and fixture changes.
		if (kind === "all") {
			denoFallback = true;
			vitestFallback = true;
			continue;
		}
		if (kind !== "deno") {
			vitest.add(file);
			vitestFallback ||= !files.has(file);
		}
		if (kind === "vitest") continue;
		const targets = files.has(file) ? matchingDenoTests(file, denoTests) : [];
		denoFallback ||= targets.length === 0;
		targets.forEach((target) => {
			deno.add(target);
		});
	}
	return {
		deno: denoFallback ? denoRoots : [...deno].sort(),
		vitest: [...vitest].sort(),
		denoFallback,
		vitestFallback,
	};
}

async function git(cwd: string, args: string[]): Promise<string> {
	const result = await new Deno.Command("git", {
		cwd,
		args,
		stdout: "piped",
		stderr: "piped",
	}).output();
	if (!result.success) throw new Error(`git ${args.join(" ")}: ${decoder.decode(result.stderr)}`);
	return decoder.decode(result.stdout);
}

function parseNameStatus(output: string): GitChanges {
	const fields = splitGitPaths(output);
	const files: string[] = [];
	const deleted: string[] = [];
	for (let index = 0; index < fields.length; index += 2) {
		const status = fields[index];
		const file = fields[index + 1];
		if (!/^[ADMTUXB]$/.test(status) || file === undefined) {
			throw new Error("Invalid Git name-status output");
		}
		files.push(file);
		if (status === "D") deleted.push(file);
	}
	return { files: files.sort(), deleted: deleted.sort() };
}

export async function changedFiles(cwd: string, mode: Mode): Promise<GitChanges> {
	// --no-renames exposes both old and new paths, including deleted tests.
	const staged = parseNameStatus(
		await git(cwd, [
			"diff",
			"--cached",
			"--name-status",
			"--no-renames",
			"-z",
			"--",
		]),
	);
	if (mode === "staged") return staged;
	const [working, untracked] = await Promise.all([
		git(cwd, ["diff", "--name-status", "--no-renames", "-z", "--"]),
		git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
	]);
	const unstaged = parseNameStatus(working);
	return {
		files: [...new Set([...staged.files, ...unstaged.files, ...splitGitPaths(untracked)])].sort(),
		deleted: [...new Set([...staged.deleted, ...unstaged.deleted])].sort(),
	};
}

async function existingFiles(cwd: string): Promise<string[]> {
	const candidates = splitGitPaths(
		await git(cwd, [
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
		]),
	);
	const existing = await Promise.all(candidates.map(async (file) => {
		try {
			return (await Deno.stat(`${cwd}/${file}`)).isFile ? file : null;
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) return null;
			throw error;
		}
	}));
	return existing.filter((file) => file !== null);
}

async function run(cwd: string, command: string, args: string[]): Promise<number> {
	console.log(`> ${command} ${args.join(" ")}`);
	return (await new Deno.Command(command, {
		cwd,
		args,
		stdout: "inherit",
		stderr: "inherit",
	}).spawn().status).code;
}

export function vitestTestCount(report: unknown): number {
	if (
		typeof report !== "object" || report === null ||
		!("numTotalTests" in report) || typeof report.numTotalTests !== "number" ||
		!Number.isInteger(report.numTotalTests) || report.numTotalTests < 0
	) {
		throw new Error("Invalid Vitest report: missing test count");
	}
	return report.numTotalTests;
}

async function runVitest(cwd: string, plan: TestPlan): Promise<number> {
	const report = await Deno.makeTempFile({ suffix: ".json" });
	try {
		const cli = `${cwd}/node_modules/vitest/vitest.mjs`;
		const base = [
			cli,
			"--run",
			"--config",
			"vitest.unit.config.ts",
			"--project",
			"unit",
			"--reporter=default",
			"--reporter=json",
			`--outputFile.json=${report}`,
		];
		if (!plan.vitestFallback) {
			const code = await run(cwd, "node", [
				base[0],
				"related",
				...base.slice(1),
				"--passWithNoTests",
				...plan.vitest,
			]);
			// Never turn compilation failures or failed tests into a fallback success.
			if (code !== 0) return code;
			if (vitestTestCount(JSON.parse(await Deno.readTextFile(report))) > 0) return 0;
			console.log("Vitest related: 0 tests; fallback to all unit tests.");
		} else {
			console.log("Vitest fallback: deleted or unmapped file; run all unit tests.");
		}
		const code = await run(cwd, "node", base);
		if (code !== 0) return code;
		if (vitestTestCount(JSON.parse(await Deno.readTextFile(report))) === 0) {
			throw new Error("Vitest fallback selected no tests");
		}
		return 0;
	} finally {
		await Deno.remove(report);
	}
}

function denoTestCount(report: string): number {
	const count = /^<testsuites\b[^>]*\btests="(\d+)"/m.exec(report)?.[1];
	if (count === undefined || !Number.isSafeInteger(Number(count))) {
		throw new Error("Invalid Deno JUnit report: missing test count");
	}
	return Number(count);
}

async function runDeno(cwd: string, plan: TestPlan): Promise<number> {
	const report = await Deno.makeTempFile({ suffix: ".xml" });
	try {
		const args = ["test", "-A", `--junit-path=${report}`];
		let code = await run(cwd, Deno.execPath(), [...args, ...plan.deno]);
		if (code !== 0) return code;
		if (denoTestCount(await Deno.readTextFile(report)) > 0) return 0;
		if (plan.denoFallback) throw new Error("Deno fallback selected no tests");
		console.log("Deno selected: 0 tests; fallback to src tests scripts.");
		code = await run(cwd, Deno.execPath(), [...args, ...denoRoots]);
		if (code !== 0) return code;
		if (denoTestCount(await Deno.readTextFile(report)) === 0) {
			throw new Error("Deno fallback selected no tests");
		}
		return 0;
	} finally {
		await Deno.remove(report);
	}
}

export async function runPlan(cwd: string, plan: TestPlan): Promise<number> {
	if (plan.denoFallback) {
		console.log("Deno fallback: deleted or unmapped file; run src tests scripts.");
	}
	if (plan.deno.length > 0) {
		const code = await runDeno(cwd, plan);
		if (code !== 0) return code;
	}
	if (plan.vitest.length > 0 || plan.vitestFallback) return await runVitest(cwd, plan);
	return 0;
}

async function main(): Promise<void> {
	const mode = Deno.args[0] ?? "changed";
	if ((mode !== "changed" && mode !== "staged") || Deno.args.length > 1) {
		throw new Error("Usage: deno run -A scripts/test_changed.ts [changed|staged]");
	}
	const cwd = (await git(Deno.cwd(), ["rev-parse", "--show-toplevel"])).trim();
	const changed = await changedFiles(cwd, mode);
	if (changed.files.length === 0) {
		console.log(`test:${mode}: no changed files.`);
		return;
	}
	console.log(`test:${mode}: ${changed.files.length} changed file(s).`);
	const plan = selectTests(changed.files, await existingFiles(cwd), changed.deleted);
	if (plan.deno.length === 0 && plan.vitest.length === 0 && !plan.vitestFallback) {
		console.log("Documentation-only changes; no executable tests.");
		return;
	}
	Deno.exitCode = await runPlan(cwd, plan);
}

if (import.meta.main) await main();
