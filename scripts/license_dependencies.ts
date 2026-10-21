import { pathToFileURL } from "node:url";
import * as v from "valibot";

const LicenseReportSchema = v.record(
	v.string(),
	v.array(v.object({
		name: v.string(),
		license: v.string(),
		paths: v.pipe(v.array(v.string()), v.minLength(1)),
	})),
);
const ManifestSchema = v.object({ version: v.string() });

export async function collectRuntimeDependencies() {
	const output = await new Deno.Command("pnpm", {
		args: ["licenses", "list", "--prod", "--json"],
		cwd: new URL("../", import.meta.url),
		stdout: "piped",
		stderr: "inherit",
	}).output();
	if (!output.success) throw new Error(`pnpm licenses exited with ${output.code}.`);
	const report = v.parse(LicenseReportSchema, JSON.parse(new TextDecoder().decode(output.stdout)));
	const entries = [];
	for (const packages of Object.values(report)) {
		for (const pkg of packages) {
			for (const path of pkg.paths) {
				const directory = pathToFileURL(`${path.replaceAll("\\", "/")}/`);
				const manifest = v.parse(
					ManifestSchema,
					JSON.parse(await Deno.readTextFile(new URL("package.json", directory))),
				);
				entries.push({
					name: pkg.name,
					version: manifest.version,
					licenseLabel: pkg.license,
					directory,
				});
			}
		}
	}
	return entries.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}
