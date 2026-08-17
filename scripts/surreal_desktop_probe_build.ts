import { buildSurrealSidecar, copySurrealCli } from "./sidecar_build.ts";

const variants = [
	{
		output: new URL("../dist-desktop/surreal-desktop-probe/", import.meta.url),
		outputArg: "./dist-desktop/surreal-desktop-probe",
		entrypoint: "scripts/surreal_desktop_probe.ts",
	},
	{
		output: new URL("../dist-desktop/surreal-desktop-static-probe/", import.meta.url),
		outputArg: "./dist-desktop/surreal-desktop-static-probe",
		entrypoint: "scripts/surreal_desktop_static_probe.ts",
	},
];

for (const variant of variants) {
	try {
		await Deno.remove(variant.output, { recursive: true });
	} catch (cause) {
		if (!(cause instanceof Deno.errors.NotFound)) {
			throw new Error("SurrealDB probe bundleを更新できません。起動中のprobeを閉じてください。", {
				cause,
			});
		}
	}

	const command = new Deno.Command(Deno.execPath(), {
		args: [
			"desktop",
			"-A",
			"--backend",
			"cef",
			"--output",
			variant.outputArg,
			variant.entrypoint,
		],
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const status = await command.spawn().status;
	if (!status.success) Deno.exit(status.code);
	await copySurrealCli(variant.output);
	await buildSurrealSidecar(variant.output);
}
