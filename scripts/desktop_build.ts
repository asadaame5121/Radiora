import { buildSurrealSidecar, copySurrealCli } from "./sidecar_build.ts";

const isWindows = Deno.build.os === "windows";
const platformLabel = isWindows ? "Windows" : "Linux";
const outputDirName = isWindows ? "radiora-v2-windows" : "radiora-v2-linux";
const outputDir = new URL(`../dist-desktop/${outputDirName}/`, import.meta.url);

const licensesIndex = new URL("../dist/licenses/index.json", import.meta.url);
try {
	await Deno.lstat(licensesIndex);
} catch {
	console.log("dist/licenses が見つからないため、ライセンス情報を生成します。");
	const licenses = new Deno.Command(Deno.execPath(), {
		args: ["run", "-A", "scripts/licenses.ts"],
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const licensesStatus = await licenses.spawn().status;
	if (!licensesStatus.success) Deno.exit(licensesStatus.code);
}

try {
	await Deno.remove(outputDir, { recursive: true });
	console.log(`Removed previous ${platformLabel} bundle and its runtime cache.`);
} catch (cause) {
	if (!(cause instanceof Deno.errors.NotFound)) {
		throw new Error(
			`${platformLabel} bundleを更新できません。起動中のRadioraウィンドウを閉じて再実行してください。`,
			{ cause },
		);
	}
}

const command = new Deno.Command(Deno.execPath(), {
	args: ["desktop", "-A", "--backend", "cef", "--include", "dist", "src/main.ts"],
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
const status = await command.spawn().status;
if (!status.success) Deno.exit(status.code);

await copySurrealCli(outputDir);
await buildSurrealSidecar(outputDir);
