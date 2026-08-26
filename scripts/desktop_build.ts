import { buildSurrealSidecar, copySurrealCli } from "./sidecar_build.ts";

const isWindows = Deno.build.os === "windows";
const platformLabel = isWindows ? "Windows" : "Linux";
const outputDirName = isWindows ? "radiora-v2-windows" : "radiora-v2-linux";
const outputDir = new URL(`../dist-desktop/${outputDirName}/`, import.meta.url);

const licensesIndex = new URL("../dist/licenses/index.json", import.meta.url);
export function resolveBackend(args: string[]): "cef" | "webview" {
	if (args.includes("--webview")) {
		return "webview";
	}
	const backendIndex = args.indexOf("--backend");
	if (backendIndex !== -1) {
		const val = args[backendIndex + 1];
		if (!val) {
			throw new Error("Missing value for --backend option. Expected 'cef' or 'webview'.");
		}
		if (val !== "cef" && val !== "webview") {
			throw new Error(`Invalid backend '${val}'. Expected 'cef' or 'webview'.`);
		}
		return val;
	}
	return "cef";
}

export async function runDesktopBuild(args: string[] = Deno.args): Promise<void> {
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

	const backend = resolveBackend(args);
	const desktopArgs = [
		"desktop",
		"-A",
		"--node-modules-dir=none",
		"--exclude-unused-npm",
		"--backend",
		backend,
		"--include",
		"dist",
		"src/main.ts",
	];
	if (args.includes("--compress")) desktopArgs.splice(-1, 0, "--compress=xz");

	const command = new Deno.Command(Deno.execPath(), {
		args: desktopArgs,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const status = await command.spawn().status;
	if (!status.success) Deno.exit(status.code);

	await copySurrealCli(outputDir);
	await buildSurrealSidecar(outputDir);
}

if (import.meta.main) {
	await runDesktopBuild();
}
