const outputDir = new URL("../dist-desktop/radiora-v2-windows/", import.meta.url);

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
