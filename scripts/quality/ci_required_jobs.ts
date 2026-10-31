// Guards the aggregate "required-checks" job of .github/workflows/ci.yml: every other job in the
// workflow must be listed in its `needs`, and it must run with `always()` so that a failed or
// skipped job can never leave the aggregate unreported. The workflow files are a fixed, simple
// layout (two-space job ids, block-list needs), which actionlint already validates syntactically.

export const AGGREGATE_JOB = "required-checks";

const JOBS_SECTION = /^jobs:\s*$/m;

export function listJobIds(workflow: string): string[] {
	const start = workflow.search(JOBS_SECTION);
	if (start === -1) throw new Error("workflow has no jobs: section");
	const body = workflow.slice(start).split(/\r?\n/).slice(1);
	const ids: string[] = [];
	for (const line of body) {
		if (/^\S/.test(line) && line.trim() !== "") break;
		const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (match?.[1]) ids.push(match[1]);
	}
	return ids;
}

function jobBlock(workflow: string, id: string): string {
	const lines = workflow.split(/\r?\n/);
	const startIndex = lines.indexOf(`  ${id}:`);
	if (startIndex === -1) throw new Error(`job ${id} not found`);
	const rest = lines.slice(startIndex + 1);
	const end = rest.findIndex((line) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function listNeeds(workflow: string, id: string): string[] {
	const block = jobBlock(workflow, id);
	const needs = /^ {4}needs:\s*\n((?: {6}- .+\n?)+)/m.exec(block);
	if (!needs?.[1]) return [];
	return needs[1]
		.split("\n")
		.map((line) => /^ {6}- (\S+)/.exec(line)?.[1])
		.filter((name): name is string => name !== undefined);
}

export function checkRequiredJobs(workflow: string): string[] {
	const problems: string[] = [];
	const ids = listJobIds(workflow);
	if (!ids.includes(AGGREGATE_JOB)) {
		return [`aggregate job ${AGGREGATE_JOB} is missing`];
	}
	const needs = new Set(listNeeds(workflow, AGGREGATE_JOB));
	for (const id of ids) {
		if (id !== AGGREGATE_JOB && !needs.has(id)) problems.push(`job ${id} is not in needs`);
	}
	for (const need of needs) {
		if (!ids.includes(need)) problems.push(`needs lists unknown job ${need}`);
	}
	if (!/^ {4}if:\s*\$\{\{\s*always\(\)\s*\}\}\s*$/m.test(jobBlock(workflow, AGGREGATE_JOB))) {
		problems.push(`${AGGREGATE_JOB} must run with if: \${{ always() }}`);
	}
	return problems;
}

if (import.meta.main) {
	const path = Deno.args[0] ?? ".github/workflows/ci.yml";
	const problems = checkRequiredJobs(await Deno.readTextFile(path));
	for (const problem of problems) console.error(`${path}: ${problem}`);
	if (problems.length > 0) Deno.exit(1);
	console.log(`${path}: aggregate job covers every job`);
}
