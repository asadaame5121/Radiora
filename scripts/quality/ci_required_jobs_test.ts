import { checkRequiredJobs, listJobIds, listNeeds } from "./ci_required_jobs.ts";

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

const ALWAYS = "$" + "{{ always() }}";
const SUCCESS = "$" + "{{ success() }}";

const workflow = (needs: string[], condition = ALWAYS) =>
	[
		"name: CI",
		"on: push",
		"jobs:",
		"  verify:",
		"    name: Verify",
		"    runs-on: ubuntu-latest",
		"    steps:",
		"      - run: echo ok",
		"  audit:",
		"    runs-on: ubuntu-latest",
		"    steps:",
		"      - run: echo ok",
		"  required-checks:",
		`    if: ${condition}`,
		"    needs:",
		...needs.map((need) => `      - ${need}`),
		"    runs-on: ubuntu-latest",
		"    steps:",
		"      - run: echo ok",
		"",
	].join("\n");

Deno.test("jobs and needs are read from the workflow layout", () => {
	const text = workflow(["verify", "audit"]);
	assert(listJobIds(text).join() === "verify,audit,required-checks", "job ids");
	assert(listNeeds(text, "required-checks").join() === "verify,audit", "needs");
});

Deno.test("a complete aggregate passes", () => {
	assert(checkRequiredJobs(workflow(["verify", "audit"])).length === 0, "valid rejected");
});

Deno.test("a job missing from needs is reported", () => {
	const problems = checkRequiredJobs(workflow(["verify"]));
	assert(problems.length === 1 && problems[0] === "job audit is not in needs", "missing not found");
});

Deno.test("an unknown need and a missing always() are reported", () => {
	assert(checkRequiredJobs(workflow(["verify", "audit", "ghost"])).length === 1, "unknown need");
	assert(checkRequiredJobs(workflow(["verify", "audit"], SUCCESS)).length === 1, "if");
});

Deno.test("a workflow without the aggregate job fails", () => {
	const text = "jobs:\n  verify:\n    runs-on: ubuntu-latest\n";
	assert(checkRequiredJobs(text).length === 1, "missing aggregate accepted");
});

Deno.test("the real ci.yml aggregates every job", async () => {
	const problems = checkRequiredJobs(await Deno.readTextFile(".github/workflows/ci.yml"));
	assert(problems.length === 0, problems.join("; "));
});
