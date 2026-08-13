type Duplicate = {
	firstFile: { name: string };
	secondFile: { name: string };
	lines: number;
	tokens: number;
};

type DuplicateReport = { duplicates?: Duplicate[] };

const BASELINE_URL = new URL("./duplicate_baseline.json", import.meta.url);
const REPORT = "reports/jscpd-ratchet/jscpd-report.json";
const UPDATE = Deno.args.includes("--update");

function npmCommand(): string {
	return Deno.build.os === "windows" ? "npm.cmd" : "npm";
}

function fingerprint(duplicate: Duplicate): string {
	const files = [duplicate.firstFile.name, duplicate.secondFile.name]
		.map((path) => path.replaceAll("\\", "/"))
		.sort();
	return `${files[0]}|${files[1]}|${duplicate.lines}|${duplicate.tokens}`;
}

const output = await new Deno.Command(npmCommand(), {
	args: ["exec", "--", "jscpd", "src", "--reporters", "json", "--output", "reports/jscpd-ratchet"],
	stdout: "inherit",
	stderr: "inherit",
}).output();
if (!output.success) throw new Error(`jscpd exited with ${output.code}.`);
const report = JSON.parse(await Deno.readTextFile(REPORT)) as DuplicateReport;
const current = [...new Set((report.duplicates ?? []).map(fingerprint))].sort();
if (UPDATE) {
	await Deno.writeTextFile(BASELINE_URL, `${JSON.stringify(current, null, "\t")}\n`);
	console.log(`Recorded ${current.length} duplicate fingerprints.`);
} else {
	const baseline = new Set(JSON.parse(await Deno.readTextFile(BASELINE_URL)) as string[]);
	const additions = current.filter((entry) => !baseline.has(entry));
	if (additions.length > 0) {
		for (const entry of additions) console.error(`New duplicate: ${entry}`);
		Deno.exit(1);
	}
	console.log(
		`Duplicate-code ratchet passed (${current.length} current, ${baseline.size} baseline).`,
	);
}
