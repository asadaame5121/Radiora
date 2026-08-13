type Diagnostic = {
	category?: string;
	location?: { path?: string; start?: { line?: number } };
};

type BiomeReport = { diagnostics?: Diagnostic[] };

const BASELINE_URL = new URL("./magic_number_baseline.json", import.meta.url);
const UPDATE = Deno.args.includes("--update");

function npmCommand(): string {
	return Deno.build.os === "windows" ? "npm.cmd" : "npm";
}

async function collectFingerprints(): Promise<string[]> {
	const command = new Deno.Command(npmCommand(), {
		args: [
			"exec",
			"--",
			"biome",
			"lint",
			"--only=lint/style/noMagicNumbers",
			"--reporter=json",
			"--max-diagnostics=10000",
			"src",
			"scripts",
		],
		stdout: "piped",
		stderr: "inherit",
	});
	const output = await command.output();
	if (!output.success) throw new Error(`Biome exited with ${output.code}.`);
	const report = JSON.parse(new TextDecoder().decode(output.stdout)) as BiomeReport;
	const occurrences = new Map<string, number>();
	const sourceCache = new Map<string, string[]>();
	const fingerprints: string[] = [];
	for (const diagnostic of report.diagnostics ?? []) {
		if (diagnostic.category !== "lint/style/noMagicNumbers") continue;
		const path = diagnostic.location?.path?.replaceAll("\\", "/");
		const line = diagnostic.location?.start?.line;
		if (!path || !line) throw new Error("Biome diagnostic is missing a source location.");
		let source = sourceCache.get(path);
		if (!source) {
			source = (await Deno.readTextFile(path)).split(/\r?\n/);
			sourceCache.set(path, source);
		}
		const snippet = (source[line - 1] ?? "").trim().replaceAll(/\s+/g, " ");
		const key = `${diagnostic.category}|${path}|${snippet}`;
		const occurrence = (occurrences.get(key) ?? 0) + 1;
		occurrences.set(key, occurrence);
		fingerprints.push(`${key}|${occurrence}`);
	}
	return fingerprints.sort();
}

async function readBaseline(): Promise<string[]> {
	return JSON.parse(await Deno.readTextFile(BASELINE_URL)) as string[];
}

const current = await collectFingerprints();
if (UPDATE) {
	await Deno.writeTextFile(BASELINE_URL, `${JSON.stringify(current, null, "\t")}\n`);
	console.log(`Recorded ${current.length} magic-number diagnostics.`);
} else {
	const baseline = new Set(await readBaseline());
	const additions = current.filter((fingerprint) => !baseline.has(fingerprint));
	if (additions.length > 0) {
		for (const fingerprint of additions) console.error(`New magic number: ${fingerprint}`);
		Deno.exit(1);
	}
	console.log(
		`Magic-number ratchet passed (${current.length} current, ${baseline.size} baseline).`,
	);
}
