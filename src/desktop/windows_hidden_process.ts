const powerShellCommand = "powershell.exe";

export function powerShellStartScript(
	workingDirectory: string,
	command: string,
	args: readonly string[],
): string {
	const argumentList = args.map(powerShellQuote).join(", ");
	return [
		"$ErrorActionPreference = 'Stop'",
		`$process = Start-Process -FilePath ${
			powerShellQuote(command)
		} -ArgumentList @(${argumentList}) -WorkingDirectory ${
			powerShellQuote(workingDirectory)
		} -WindowStyle Hidden -PassThru`,
		"[Console]::Out.Write($process.Id)",
	].join("; ");
}

export function powerShellStopScript(pid: number, port: number): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		...powerShellListenerPidScript(port),
		"if ($null -ne $listenerPid) { Stop-Process -Id $listenerPid -Force -ErrorAction Stop }",
		`if ($null -ne (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { Stop-Process -Id ${pid} -Force -ErrorAction Stop }`,
	].join("; ");
}

export function powerShellRecoverListenerScript(port: number): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		...powerShellListenerPidScript(port),
		"if ($null -eq $listenerPid) { exit 0 }",
		"$target = Get-Process -Id $listenerPid -ErrorAction Stop",
		`if ($target.ProcessName -ne 'surreal') { [Console]::Error.Write('Port ${port} is owned by ' + $target.ProcessName); exit 2 }`,
		"Stop-Process -Id $target.Id -Force -ErrorAction Stop",
		"[Console]::Out.Write('stopped')",
	].join("; ");
}

function powerShellListenerPidScript(port: number): string[] {
	return [
		`$listenerLine = netstat.exe -ano -p tcp | Select-String -Pattern '^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+\\d+\\s*$' | Select-Object -First 1`,
		"$listenerPid = $null",
		"if ($null -ne $listenerLine) { $listenerPid = [int](($listenerLine.Line.Trim() -split '\\s+')[-1]) }",
	];
}

export async function spawnWindowsHiddenProcess(
	workingDirectory: string,
	command: string,
	args: readonly string[],
): Promise<number> {
	const output = await runPowerShell(powerShellStartScript(workingDirectory, command, args));
	if (!output.success) throw powerShellError("start", output);
	const pid = Number(new TextDecoder().decode(output.stdout).trim());
	if (!Number.isInteger(pid) || pid < 1) {
		throw new Error("Windows hidden process launcher returned no PID.");
	}
	return pid;
}

export async function recoverWindowsStaleSurrealListener(port: number): Promise<boolean> {
	const output = await runPowerShell(powerShellRecoverListenerScript(port));
	if (!output.success) throw powerShellError(`recover stale listener on port ${port}`, output);
	return new TextDecoder().decode(output.stdout).trim() === "stopped";
}

export async function stopWindowsHiddenProcess(
	_workingDirectory: string,
	pid: number,
	port: number,
): Promise<void> {
	const output = await runPowerShell(powerShellStopScript(pid, port));
	if (!output.success) throw powerShellError(`stop process ${pid}`, output);
}

export async function isWindowsHiddenProcessRunning(
	_workingDirectory: string,
	pid: number,
): Promise<boolean> {
	const output = await runPowerShell(
		`if ($null -ne (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { exit 0 }; exit 1`,
	);
	return output.success;
}

async function runPowerShell(script: string): Promise<Deno.CommandOutput> {
	return await new Deno.Command(powerShellCommand, {
		args: [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-WindowStyle",
			"Hidden",
			"-EncodedCommand",
			encodePowerShellCommand(script),
		],
		stdin: "null",
		stdout: "piped",
		stderr: "piped",
	}).output();
}

function powerShellQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function encodePowerShellCommand(script: string): string {
	let utf16le = "";
	for (let index = 0; index < script.length; index++) {
		const code = script.charCodeAt(index);
		utf16le += String.fromCharCode(code & 0xff, code >>> 8);
	}
	return btoa(utf16le);
}

function powerShellError(action: string, output: Deno.CommandOutput): Error {
	const decoder = new TextDecoder();
	const detail = [decoder.decode(output.stderr), decoder.decode(output.stdout)]
		.map((value) => value.trim())
		.find(Boolean);
	return new Error(
		detail
			? `Windows hidden process ${action} failed: ${detail}`
			: `Windows hidden process ${action} failed.`,
	);
}
