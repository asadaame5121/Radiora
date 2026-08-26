if (Deno.build.os !== "windows" && Deno.build.os !== "linux") {
	throw new Error("Desktop bundleはWindowsまたはLinuxで実行してください。");
}

const isWindows = Deno.build.os === "windows";
const storageMode = Deno.args.includes("--json")
	? "json"
	: Deno.args.includes("--surreal-diagnostic")
	? "surreal-diagnostic"
	: Deno.args.includes("--surreal")
	? "surreal"
	: "sqlite";
const outputDir = new URL(
	isWindows ? "../dist-desktop/radiora-v2-windows/" : "../dist-desktop/radiora-v2-linux/",
	import.meta.url,
);
const entries = [];
for await (const entry of Deno.readDir(outputDir)) entries.push(entry);

let launcher: Deno.DirEntry | undefined;
if (isWindows) {
	launcher = entries.find((entry) => entry.isFile && entry.name.endsWith(".bat")) ??
		entries.find((entry) =>
			entry.isFile &&
			entry.name.endsWith(".exe") &&
			!entry.name.startsWith("bootstrap") &&
			entry.name.toLowerCase() !== "radiora-surreal.exe" &&
			entry.name.toLowerCase() !== "surreal.exe"
		);
} else {
	launcher = entries.find((entry) => entry.isFile && entry.name === "radiora-v2-linux") ??
		entries.find((entry) =>
			entry.isFile &&
			!entry.name.startsWith("bootstrap") &&
			!entry.name.endsWith(".so") &&
			!entry.name.endsWith(".pak") &&
			!entry.name.endsWith(".dat") &&
			!entry.name.endsWith(".json") &&
			!entry.name.endsWith(".png") &&
			!entry.name.endsWith(".desktop") &&
			entry.name !== "surreal" &&
			entry.name !== "chrome-sandbox"
		);
}
if (!launcher) {
	throw new Error("Desktop launcher が見つかりません。先にbuildしてください。");
}

if (isWindows) {
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
} else {
	const launcherPath = new URL(launcher.name, outputDir);
	const status = await new Deno.Command(launcherPath, {
		env: { RADIORA_STORAGE: storageMode },
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	}).spawn().status;
	if (!status.success) Deno.exit(status.code);
}
