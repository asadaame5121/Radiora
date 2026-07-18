if (Deno.build.os !== "windows") {
	throw new Error("SurrealDB desktop probeはWindows PowerShellまたはNushellから実行してください。");
}

const stage = (Deno.args[0] ?? "p0").toLowerCase();
if (!["p0", "p1", "p2", "p3", "p5"].includes(stage)) {
	throw new Error(`Probe stage must be one of p0, p1, p2, p3, p5: ${stage}`);
}
const outputDir = new URL(
	stage === "p5"
		? "../dist-desktop/surreal-desktop-static-probe/"
		: "../dist-desktop/surreal-desktop-probe/",
	import.meta.url,
);
const entries = [];
for await (const entry of Deno.readDir(outputDir)) entries.push(entry);
const launcher = entries.find((entry) => entry.isFile && entry.name.endsWith(".bat")) ??
	entries.find((entry) =>
		entry.isFile && entry.name.endsWith(".exe") && !entry.name.startsWith("bootstrap")
	);
if (!launcher) {
	throw new Error("Probe launcher (.bat/.exe) が見つかりません。先にbuildしてください。");
}

const launcherPath = new URL(launcher.name, outputDir).pathname.slice(1).replaceAll("/", "\\");
const command = launcher.name.endsWith(".bat") ? "cmd.exe" : launcherPath;
const args = launcher.name.endsWith(".bat") ? ["/d", "/c", launcherPath] : [];
const status = await new Deno.Command(command, {
	args,
	env: { RADIORA_SURREAL_PROBE_STAGE: stage },
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
}).spawn().status;
if (!status.success) Deno.exit(status.code);
