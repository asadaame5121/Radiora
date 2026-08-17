type ProbePhase = "starting" | "running" | "passed" | "failed";

interface ProbeStatus {
	phase: ProbePhase;
	stage: string;
	detail?: string;
	logPath: string;
}

const appData = Deno.env.get("LOCALAPPDATA") ?? Deno.env.get("APPDATA") ?? Deno.cwd();
const rootDir = `${appData}\\RadioraV2`;
const logDir = `${rootDir}\\logs`;
const logPath = `${logDir}\\surreal-desktop-probe.log`;
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}`;
const dataDir = `${rootDir}\\probe-data\\${runId}`;
const databasePath = `${dataDir}\\test.db`;
const host = "127.0.0.1";
const port = 18013;
const endpoint = `ws://${host}:${port}`;
const probeStage = (Deno.env.get("RADIORA_SURREAL_PROBE_STAGE") ?? "p0").toLowerCase();

Deno.mkdirSync(logDir, { recursive: true });
Deno.mkdirSync(dataDir, { recursive: true });

let status: ProbeStatus = {
	phase: "starting",
	stage: "probe.runtime.ready",
	logPath,
};
let child: Deno.ChildProcess | null = null;
let cliOutputTasks: Promise<void>[] = [];
let managedProcess: { endpoint: string; start(): Promise<void>; stop(): Promise<void> } | null =
	null;

function formatDetail(detail: unknown): string {
	if (detail instanceof Error) return `${detail.name}: ${detail.message}\n${detail.stack ?? ""}`;
	if (detail === undefined) return "";
	try {
		return JSON.stringify(detail);
	} catch {
		return String(detail);
	}
}

function trace(stage: string, detail?: unknown): void {
	const rendered = formatDetail(detail);
	const line = `[surreal-desktop-probe ${new Date().toISOString()}] ${stage}${
		rendered ? ` ${rendered}` : ""
	}\n`;
	try {
		Deno.writeTextFileSync(logPath, line, { append: true, create: true });
		// biome-ignore lint/plugin/noSwallowedRejection: Probe diagnostics must continue to stderr when the optional log file is unavailable.
	} catch {
		// A failed diagnostic write must not hide the stage being tested.
	}
	console.error(line.trimEnd());
	status = { ...status, stage, detail: rendered || undefined };
}

async function step<T>(stage: string, operation: () => Promise<T>): Promise<T> {
	trace(`${stage}.begin`);
	try {
		const result = await operation();
		trace(`${stage}.ready`);
		return result;
	} catch (cause) {
		trace(`${stage}.failed`, cause);
		throw cause;
	}
}

async function relayCliOutput(
	stream: ReadableStream<Uint8Array>,
	channel: "stdout" | "stderr",
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				pending += decoder.decode();
				if (pending) trace(`cli.${channel}`, pending);
				return;
			}
			pending += decoder.decode(value, { stream: true });
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (line) trace(`cli.${channel}`, line);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

async function findSurrealCommand(): Promise<string> {
	const userProfile = Deno.env.get("USERPROFILE");
	const executablePath = Deno.execPath();
	const bundleDir = executablePath.slice(0, executablePath.lastIndexOf("\\"));
	const candidates = [
		`${bundleDir}\\radiora-surreal.exe`,
		`${bundleDir}\\surreal.exe`,
		"surreal",
		...(userProfile ? [`${userProfile}\\.surrealdb\\surreal.exe`] : []),
	];
	for (const command of candidates) {
		try {
			const output = await new Deno.Command(command, {
				args: ["version"],
				stdout: "piped",
				stderr: "piped",
			}).output();
			if (output.success) {
				trace("cli.command.ready", {
					command,
					version: new TextDecoder().decode(output.stdout).trim(),
				});
				return command;
			}
			trace("cli.command.failed", {
				command,
				code: output.code,
				stderr: new TextDecoder().decode(output.stderr).trim(),
			});
			// biome-ignore lint/plugin/noSwallowedRejection: A failed executable probe means this candidate is unavailable; the next candidate is tried.
		} catch {
			// Try the next known installation location.
		}
	}
	throw new Error("SurrealDB CLI was not found in PATH or %USERPROFILE%\\.surrealdb.");
}

async function waitUntilHealthy(): Promise<void> {
	for (let attempt = 1; attempt <= 150; attempt++) {
		try {
			const response = await fetch(`http://${host}:${port}/health`);
			if (response.ok) {
				trace("cli.health.ready", { attempt });
				return;
			}
			// biome-ignore lint/plugin/noSwallowedRejection: Connection failures are expected while the bounded readiness poll is starting.
		} catch {
			// The server is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error("SurrealDB did not become healthy within 30 seconds.");
}

async function stopChild(): Promise<void> {
	const active = child;
	child = null;
	if (!active) return;
	trace("cli.stop.begin");
	try {
		active.kill(Deno.build.os === "windows" ? "SIGKILL" : "SIGTERM");
		// biome-ignore lint/plugin/noSwallowedRejection: The child may already have exited before teardown sends the signal.
	} catch {
		// The process already exited.
	}
	// biome-ignore lint/plugin/noSwallowedRejection: Exit status rejection during forced teardown has no remaining recovery action.
	await active.status.catch(() => undefined);
	await Promise.allSettled(cliOutputTasks);
	cliOutputTasks = [];
	trace("cli.stop.ready");
}

async function closeChildByStdin(): Promise<void> {
	const active = child;
	child = null;
	if (!active) return;
	trace("cli.stdin-eof.begin");
	// biome-ignore lint/plugin/noSwallowedRejection: EOF teardown has no recovery path after the child is stopped.
	const stdinClose = active.stdin?.close().catch(() => undefined);
	if (stdinClose) {
		await Promise.race([
			stdinClose,
			new Promise<void>((resolve) => setTimeout(resolve, 1000)),
		]);
	}
	// biome-ignore lint/plugin/noSwallowedRejection: Exit status rejection during EOF teardown has no remaining recovery action.
	await active.status.catch(() => undefined);
	await Promise.allSettled(cliOutputTasks);
	cliOutputTasks = [];
	trace("cli.stdin-eof.ready");
}

async function waitForPortRelease(): Promise<void> {
	for (let attempt = 1; attempt <= 50; attempt++) {
		try {
			const listener = Deno.listen({ hostname: host, port });
			listener.close();
			trace("sidecar.port-release.ready", { attempt });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`Port ${port} was not released after the sidecar stopped.`);
}

async function runSidecarLifecycleProbe(): Promise<void> {
	await closeChildByStdin();
	await waitForPortRelease();
	await startRawChild();
	await stopChild();
	await waitForPortRelease();
}

async function startRawChild(): Promise<void> {
	const command = await step("cli.command", findSurrealCommand);
	if (probeStage === "sidecar" && !command.toLowerCase().endsWith("radiora-surreal.exe")) {
		throw new Error(`The sidecar probe did not select radiora-surreal.exe: ${command}`);
	}
	trace("cli.spawn.begin", { command });
	child = new Deno.Command(command, {
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
		stdout: "piped",
		stderr: "piped",
		stdin: "piped",
	}).spawn();
	trace("cli.spawn.ready", { pid: child.pid });
	cliOutputTasks = [
		relayCliOutput(child.stdout, "stdout"),
		relayCliOutput(child.stderr, "stderr"),
	];
	await step("cli.health", waitUntilHealthy);
}

async function runRawSdk(targetEndpoint: string): Promise<void> {
	trace("sdk.import.begin");
	const { Surreal } = await import("surrealdb");
	trace("sdk.import.ready");
	trace("sdk.constructor.begin");
	const db = new Surreal();
	trace("sdk.constructor.ready");
	try {
		await step("sdk.connect", () =>
			db.connect(targetEndpoint, {
				authentication: { username: "root", password: "root" },
			}));
		await step("sdk.use", () => db.use({ namespace: "main", database: "main" }));
		const result = await step("sdk.query", () => db.query("RETURN 'desktop-probe-ok';"));
		trace("sdk.query.result", result);
	} finally {
		await step("sdk.close", () => db.close());
	}
}

async function runStoreScenario(targetEndpoint: string, full: boolean): Promise<void> {
	trace("actual-modules.import.begin");
	const [{ SurrealGraphStore }, { OutlineService }] = await Promise.all([
		import("../src/storage/surreal_store.ts"),
		import("../src/services/outline_service.ts"),
	]);
	trace("actual-modules.import.ready");

	let store = new SurrealGraphStore(targetEndpoint, "root", "root", trace);
	await store.initialize();
	if (!full) {
		const items = await step("actual-store.list", () => store.listItems());
		trace("actual-store.result", { items: items.length });
		await store.close();
		return;
	}

	let service = new OutlineService(store);
	const root = await step(
		"service.create-root",
		() => service.createItem({ text: "desktop diagnostic root", parentId: null }),
	);
	const child = await step(
		"service.create-child",
		() => service.createItem({ text: "desktop diagnostic child", parentId: root.id }),
	);
	const disposable = await step(
		"service.create-disposable",
		() => service.createItem({ text: "desktop diagnostic disposable", parentId: null }),
	);
	await step(
		"service.update",
		() => service.updateItemText(child.id, "desktop diagnostic child updated"),
	);
	await step("service.collapse", () => service.setCollapsed(root.id, true));
	await step("service.move", () => service.moveItem({ id: child.id, parentId: root.id }));
	await step(
		"service.link",
		() => service.createLink({ fromId: root.id, toId: child.id, type: "LIKE" }),
	);
	const search = await step("service.search", () => service.searchItems("child updated"));
	if (search.length !== 1 || search[0].item.id !== child.id) {
		throw new Error(`Search verification failed: ${JSON.stringify(search)}`);
	}
	await step("service.delete", () => service.deleteItem(disposable.id));
	await step("service.first-snapshot", () => service.listOutline());
	await step("service.first-close", () => store.close());

	store = new SurrealGraphStore(targetEndpoint, "root", "root", trace);
	await store.initialize();
	service = new OutlineService(store);
	const snapshot = await step("service.persistence-read", () => service.listOutline());
	const persistedRoot = snapshot.items.find((item) => item.id === root.id);
	const persistedChild = snapshot.items.find((item) => item.id === child.id);
	if (
		snapshot.items.length !== 2 || snapshot.links.length !== 1 ||
		persistedRoot?.collapsed !== true || persistedChild?.parentId !== root.id
	) {
		throw new Error(`Persistence verification failed: ${JSON.stringify(snapshot)}`);
	}
	trace("service.persistence-ready", { items: 2, links: 1 });
	await step("service.second-close", () => store.close());
}

async function runProbe(): Promise<void> {
	status = { ...status, phase: "running" };
	trace("probe.begin", {
		stage: probeStage,
		runId,
		deno: Deno.version.deno,
		v8: Deno.version.v8,
		os: Deno.build.os,
		endpoint,
		dataDir,
	});
	try {
		if (!["p0", "p1", "p2", "p3", "p5", "sidecar"].includes(probeStage)) {
			throw new Error(`Unknown probe stage: ${probeStage}`);
		}
		if (probeStage === "p0" || probeStage === "p2" || probeStage === "sidecar") {
			await startRawChild();
		} else {
			trace("actual-process.import.begin");
			const { SurrealProcess } = await import("../src/desktop/surreal_process.ts");
			trace("actual-process.import.ready");
			managedProcess = new SurrealProcess(databasePath, host, port, trace);
			await managedProcess.start();
		}

		const targetEndpoint = managedProcess?.endpoint ?? endpoint;
		if (probeStage === "p0" || probeStage === "p1" || probeStage === "sidecar") {
			await runRawSdk(targetEndpoint);
			if (probeStage === "sidecar") await runSidecarLifecycleProbe();
		} else {
			await runStoreScenario(targetEndpoint, probeStage === "p3" || probeStage === "p5");
		}

		status = { ...status, phase: "passed", stage: "probe.passed", detail: undefined };
		trace("probe.passed");
	} catch (cause) {
		status = { ...status, phase: "failed", stage: "probe.failed", detail: formatDetail(cause) };
		trace("probe.failed", cause);
	} finally {
		await managedProcess?.stop().catch((cause) => trace("actual-process.stop.failed", cause));
		managedProcess = null;
		await stopChild();
		await Deno.remove(dataDir, { recursive: true }).catch((cause) =>
			trace("probe.data-cleanup.failed", cause)
		);
	}
}

const page = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SurrealDB Desktop Probe</title>
<style>
body{margin:0;background:#111310;color:#deddd6;font:15px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{width:min(720px,calc(100vw - 64px));background:#191c18;border:1px solid #343a32;border-radius:14px;padding:32px;box-shadow:0 20px 60px #0008}
h1{font-size:22px;margin:0 0 8px}.label{color:#9ca794;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
#phase{font-size:32px;font-weight:700;margin:20px 0 4px}.starting,.running{color:#d8b76c}.passed{color:#83cc8d}.failed{color:#ff8f87}
code,pre{background:#0c0e0c;border-radius:6px;padding:3px 7px}pre{padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;color:#c8cec3}
</style>
<main><p class="label">Deno Desktop / SurrealDB isolated verification</p><h1>SurrealDB Desktop Probe</h1>
<div id="phase" class="starting">STARTING</div><p id="stage">probe.runtime.ready</p><pre id="detail"></pre>
<p>永続ログ: <code id="log"></code></p></main>
<script>
async function poll(){try{const r=await fetch('/api/status',{method:'POST'});const s=await r.json();
phase.textContent=s.phase.toUpperCase();phase.className=s.phase;stage.textContent=s.stage;
detail.textContent=s.detail||'';log.textContent=s.logPath;}catch(e){detail.textContent=String(e)}
if(!['passed','failed'].includes(phase.className))setTimeout(poll,200)}poll();
</script></html>`;

trace("probe.runtime.ready", { logPath });
setTimeout(() => void runProbe(), 250);

addEventListener("unload", () => {
	void stopChild();
});

const server = Deno.serve((request) => {
	const url = new URL(request.url);
	if (url.pathname === "/api/status" && request.method === "POST") return Response.json(status);
	return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
});
await server.finished;
