const outputDir = new URL("../dist-desktop/radiora-v2-windows/", import.meta.url);

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
	console.log("Removed previous Windows bundle and its WebView2 runtime cache.");
} catch (cause) {
	if (!(cause instanceof Deno.errors.NotFound)) {
		throw new Error(
			"Windows bundleを更新できません。起動中のRadioraウィンドウを閉じて再実行してください。",
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

const surrealSource = Deno.env.get("RADIORA_SURREAL_BUNDLE_SOURCE") ??
	(Deno.env.get("USERPROFILE") ? `${Deno.env.get("USERPROFILE")}\\.surrealdb\\surreal.exe` : null);
if (surrealSource) {
	try {
		const info = await Deno.stat(surrealSource);
		if (!info.isFile) throw new Error("not a file");
		await Deno.copyFile(surrealSource, new URL("surreal.exe", outputDir));
		console.log(`Bundled SurrealDB CLI: ${surrealSource} (${info.size} bytes)`);
	} catch {
		console.warn(
			`SurrealDB CLI が見つかりません: ${surrealSource}。配布物には含まれません。` +
				"RADIORA_SURREAL_BUNDLE_SOURCE でパスを指定できます。",
		);
	}
} else {
	console.warn("SurrealDB CLI のコピー元がありません。USERPROFILE を確認してください。");
}
