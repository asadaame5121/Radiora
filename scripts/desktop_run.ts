if (Deno.build.os !== "windows") {
	throw new Error("Desktop bundleはWindows PowerShellまたはNushellから実行してください。");
}

const storageMode = Deno.args.includes("--surreal") ? "surreal-diagnostic" : "json";
const outputDir = new URL("../dist-desktop/radiora-v2-windows/", import.meta.url);
const entries = [];
for await (const entry of Deno.readDir(outputDir)) entries.push(entry);
const launcher = entries.find((entry) => entry.isFile && entry.name.endsWith(".bat")) ??
	entries.find((entry) =>
		entry.isFile && entry.name.endsWith(".exe") && !entry.name.startsWith("bootstrap")
	);
if (!launcher) {
	throw new Error("Desktop launcher (.bat/.exe) が見つかりません。先にbuildしてください。");
}

const launcherPath = new URL(launcher.name, outputDir).pathname.slice(1).replaceAll("/", "\\");
const command = launcher.name.endsWith(".bat") ? "cmd.exe" : launcherPath;
const args = launcher.name.endsWith(".bat") ? ["/d", "/c", launcherPath] : [];
const status = await new Deno.Command(command, {
	args,
	env: { RADIORA_STORAGE: storageMode },
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
}).spawn().status;
if (!status.success) Deno.exit(status.code);
