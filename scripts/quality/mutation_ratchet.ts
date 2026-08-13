type Mutant = {
	id: string;
	mutatorName: string;
	replacement?: string;
	status: string;
	location: { start: { line: number; column: number } };
};

type MutationFile = { source: string; mutants: Mutant[] };
type MutationReport = { files: Record<string, MutationFile> };

const [batch, flag] = Deno.args;
if (!batch) throw new Error("Usage: mutation_ratchet.ts <batch> [--update]");
const reportPath = `reports/mutation/${batch}.json`;
const baselinePath = new URL(`./mutation_${batch}_baseline.json`, import.meta.url);

const report = JSON.parse(await Deno.readTextFile(reportPath)) as MutationReport;
const survivors: string[] = [];
for (const [path, file] of Object.entries(report.files)) {
	const lines = file.source.split(/\r?\n/);
	const occurrences = new Map<string, number>();
	for (const mutant of file.mutants) {
		if (mutant.status !== "Survived" && mutant.status !== "NoCoverage") continue;
		const snippet = (lines[mutant.location.start.line - 1] ?? "").trim().replaceAll(/\s+/g, " ");
		const key = `${path.replaceAll("\\", "/")}|${mutant.status}|${mutant.mutatorName}|${snippet}|${
			mutant.replacement ?? ""
		}`;
		const occurrence = (occurrences.get(key) ?? 0) + 1;
		occurrences.set(key, occurrence);
		survivors.push(`${key}|${occurrence}`);
	}
}
survivors.sort();

if (flag === "--update") {
	await Deno.writeTextFile(baselinePath, `${JSON.stringify(survivors, null, "\t")}\n`);
	console.log(`Recorded ${survivors.length} mutation findings for ${batch}.`);
} else {
	const baseline = new Set(JSON.parse(await Deno.readTextFile(baselinePath)) as string[]);
	const additions = survivors.filter((entry) => !baseline.has(entry));
	if (additions.length > 0) {
		for (const entry of additions) console.error(`New mutation finding: ${entry}`);
		Deno.exit(1);
	}
	console.log(`Mutation ratchet passed for ${batch}.`);
}
