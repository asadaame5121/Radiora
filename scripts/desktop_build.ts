const isWindows = Deno.build.os === "windows";
const pathSeparator = isWindows ? "\\" : "/";
const platformLabel = isWindows ? "Windows" : "Linux";
const outputDirName = isWindows ? "radiora-v2-windows" : "radiora-v2-linux";
const surrealCliName = isWindows ? "surreal.exe" : "surreal";
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

const homeDir = isWindows ? Deno.env.get("USERPROFILE") : Deno.env.get("HOME");
const defaultSurrealSource = homeDir
	? `${homeDir}${pathSeparator}.surrealdb${pathSeparator}${surrealCliName}`
	: null;
const surrealSource = Deno.env.get("RADIORA_SURREAL_BUNDLE_SOURCE") ?? defaultSurrealSource;
if (surrealSource) {
	try {
		const info = await Deno.stat(surrealSource);
		if (!info.isFile) throw new Error("not a file");
		await Deno.copyFile(surrealSource, new URL(surrealCliName, outputDir));
		console.log(`Bundled SurrealDB CLI: ${surrealSource} (${info.size} bytes)`);
	} catch {
		console.warn(
			`SurrealDB CLI が見つかりません: ${surrealSource}。配布物には含まれません。` +
				"RADIORA_SURREAL_BUNDLE_SOURCE でパスを指定できます。",
		);
	}
} else {
	console.warn(
		`SurrealDB CLI のコピー元がありません。${
			isWindows ? "USERPROFILE" : "HOME"
		} を確認してください。`,
	);
}
