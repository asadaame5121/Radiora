const appData = Deno.env.get("LOCALAPPDATA") ?? Deno.env.get("APPDATA") ?? Deno.cwd();
const logDir = `${appData}\\RadioraV2\\logs`;
const logPath = `${logDir}\\surreal-desktop-probe.log`;
Deno.mkdirSync(logDir, { recursive: true });
Deno.writeTextFileSync(
	logPath,
	`[surreal-desktop-probe ${new Date().toISOString()}] static-entry.before-sdk-import\n`,
	{ append: true, create: true },
);
