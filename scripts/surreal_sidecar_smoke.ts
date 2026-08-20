if (Deno.build.os !== "windows") {
	throw new Error("SurrealDB sidecar smokeはWindowsで実行してください。");
}

const bundleDir = new URL("../dist-desktop/radiora-v2-windows/", import.meta.url);
const sidecar = new URL("radiora-surreal.exe", bundleDir);
const dataDir = await Deno.makeTempDir({ prefix: "radiora-sidecar-smoke-" });
const host = "127.0.0.1";
const databasePath = `${dataDir}\\main.db`;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
	const reader = stream.getReader();
	let bytes = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) return bytes;
			bytes += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
}

async function waitUntilHealthy(port: number): Promise<void> {
	for (let attempt = 1; attempt <= 150; attempt++) {
		try {
			const response = await fetch(`http://${host}:${port}/health`);
			if (response.ok) return;
			// biome-ignore lint/plugin/noSwallowedRejection: Connection failures are expected while the bounded readiness poll is starting.
		} catch {
			// The server is still starting.
		}
		await delay(200);
	}
	throw new Error("SurrealDB sidecar did not become healthy within 30 seconds.");
}

async function waitForPortRelease(port: number): Promise<void> {
	for (let attempt = 1; attempt <= 50; attempt++) {
		try {
			const listener = Deno.listen({ hostname: host, port });
			listener.close();
			return;
		} catch {
			await delay(100);
		}
	}
	throw new Error(`Port ${port} was not released after the sidecar stopped.`);
}

async function processSnapshot(): Promise<Map<string, Set<number>>> {
	const output = await new Deno.Command("tasklist", {
		args: ["/FO", "CSV", "/NH"],
		stdout: "piped",
		stderr: "piped",
	}).output();
	if (!output.success) throw new Error("tasklist failed while checking sidecar cleanup.");
	const processes = new Map<string, Set<number>>();
	for (const line of new TextDecoder().decode(output.stdout).split(/\r?\n/)) {
		const match = line.match(/^"([^"]+)","(\d+)"/);
		if (!match) continue;
		const name = match[1].toLowerCase();
		const pids = processes.get(name) ?? new Set<number>();
		pids.add(Number(match[2]));
		processes.set(name, pids);
	}
	return processes;
}

async function assertNoSidecarProcesses(
	baseline: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<void> {
	for (let attempt = 1; attempt <= 50; attempt++) {
		const current = await processSnapshot();
		const hasNewProcess = ["radiora-surreal.exe", "surreal.exe"].some((name) =>
			[...(current.get(name) ?? [])].some((pid) => !(baseline.get(name)?.has(pid) ?? false))
		);
		if (!hasNewProcess) return;
		await delay(100);
	}
	throw new Error("SurrealDB or radiora-surreal.exe remained after sidecar shutdown.");
}

function start(port: number): {
	process: Deno.ChildProcess;
	output: Promise<number[]>;
} {
	const process = new Deno.Command(sidecar, {
		args: [
			"start",
			"--user",
			"root",
			"--pass",
			"root",
			"--bind",
			`${host}:${port}`,
			`rocksdb:${databasePath}`,
		],
		stdin: "piped",
		stdout: "piped",
		stderr: "piped",
	}).spawn();
	return {
		process,
		output: Promise.all([
			drain(process.stdout).catch(() => 0),
			drain(process.stderr).catch(() => 0),
		]),
	};
}

async function stopByStdin(process: Deno.ChildProcess): Promise<number> {
	// biome-ignore lint/plugin/noSwallowedRejection: EOF teardown is best-effort after the child has been asked to stop.
	const stdinClose = process.stdin?.close().catch(() => undefined);
	const status = await process.status;
	if (stdinClose) await Promise.race([stdinClose, delay(1000)]);
	return status.code;
}

async function terminate(process: Deno.ChildProcess): Promise<number> {
	try {
		process.kill("SIGKILL");
		// The wrapper may already have exited after its child was terminated.
		// biome-ignore lint/plugin/noSwallowedRejection: The process may already have exited before forced teardown.
	} catch {
		// The process already exited.
	}
	return (await process.status).code;
}

const portListener = Deno.listen({ hostname: host, port: 0 });
const portAddress = portListener.addr;
if (portAddress.transport !== "tcp") throw new Error("The smoke test did not get a TCP port.");
const port = portAddress.port;
portListener.close();
const baselineProcesses = await processSnapshot();
let active: ReturnType<typeof start> | null = null;

try {
	const first = start(port);
	active = first;
	await waitUntilHealthy(port);
	const eofCode = await stopByStdin(first.process);
	const firstOutputBytes = (await first.output).reduce((total, value) => total + value, 0);
	active = null;
	await waitForPortRelease(port);
	if (firstOutputBytes === 0) throw new Error("The sidecar produced no stdout/stderr output.");

	const second = start(port);
	active = second;
	await waitUntilHealthy(port);
	const terminateCode = await terminate(second.process);
	const secondOutputBytes = (await second.output).reduce((total, value) => total + value, 0);
	active = null;
	await waitForPortRelease(port);
	await assertNoSidecarProcesses(baselineProcesses);
	console.log(JSON.stringify({ eofCode, terminateCode, firstOutputBytes, secondOutputBytes }));
} finally {
	if (active) {
		try {
			await terminate(active.process);
			await active.output;
		} catch (cause) {
			console.error(`Sidecar cleanup failed: ${cause instanceof Error ? cause.message : cause}`);
		}
	}
	// biome-ignore lint/plugin/noSwallowedRejection: Temporary smoke data is disposable after the process checks finish.
	await Deno.remove(dataDir, { recursive: true }).catch(() => undefined);
}
