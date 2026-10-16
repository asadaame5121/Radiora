/**
 * Test-only controller for the Issue #329 SQLite smoke host.
 *
 * Node builtins only, so the same module drives the Deno integration test here and the
 * Stage 3 Playwright fixture under Node. It owns exactly what it creates: one temp root per
 * attempt, the port the first host reports, and the child processes it spawned. Every stop
 * path is bounded by one deadline and only ever touches its own child.
 *
 * The host itself stays a Deno entry (`sqlite_host.ts`). The executable comes from an explicit
 * `launch.file`, `RADIORA_DENO_BIN`, or `deno` on PATH; commands spawn without a shell, so no
 * path or argument is interpreted as shell text.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_ENTRY = fileURLToPath(new URL("./sqlite_host.ts", import.meta.url));
const READY_EVENT = "test_host.ready";
const READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 5_000;
const MAX_CAPTURE_CHARS = 65_536;
const MAX_PENDING_LINE_CHARS = 4_096;
const REMOVE_MAX_RETRIES = 20;
const REMOVE_RETRY_DELAY_MS = 50;
const SHUTDOWN_NOTICE = "shutdown\n";

/** Lifecycle tests only: replaces the default `deno run -A <host> ...` command. */
export interface HostLaunch {
	readonly file?: string;
	readonly args?: readonly string[];
}

export interface StartHostOptions {
	readonly dataDir: string;
	readonly token: string;
	readonly distDir: string;
	/** Requested port; 0 asks the OS. An attempt records the port its first host reports. */
	readonly port?: number;
	readonly readyTimeoutMs?: number;
	readonly launch?: HostLaunch;
}

export interface SqliteHost {
	readonly origin: string;
	readonly port: number;
	readonly pid: number;
	readonly dataDir: string;
	readonly stdout: string;
	readonly stderr: string;
	/** True once stdio closed and the exit was observed. */
	readonly exited: boolean;
	/** Bounded shutdown; a rejection carries pid context, notes, and captured output. */
	stop(): Promise<number | null>;
}

export interface SmokeAttempt {
	readonly root: string;
	readonly dataDir: string;
	readonly token: string;
	/** Port the first host reported; restarts request it so a browser origin stays stable. */
	readonly port: number | undefined;
	start(distDir: string): Promise<SqliteHost>;
	cleanup(): Promise<void>;
}

interface ReadyInfo {
	readonly origin: string;
	readonly port: number;
	readonly pid: number;
}

interface SpawnSettlement {
	readonly code: number | null;
	readonly signal: string | null;
	readonly error?: Error;
}

interface ExitTracker {
	readonly settled: Promise<SpawnSettlement>;
	isSettled(): boolean;
}

/** Bounded raw capture plus line extraction; both buffers keep only a tail. */
class StdioCapture {
	#text = "";
	#pending = "";
	#onLine: ((line: string) => void) | undefined;

	constructor(onLine?: (line: string) => void) {
		this.#onLine = onLine;
	}

	append(chunk: string): void {
		this.#text = boundedTail(`${this.#text}${chunk}`, MAX_CAPTURE_CHARS);
		this.#pending += chunk;
		let index = this.#pending.indexOf("\n");
		while (index >= 0) {
			this.#onLine?.(this.#pending.slice(0, index).replace(/\r$/, ""));
			this.#pending = this.#pending.slice(index + 1);
			index = this.#pending.indexOf("\n");
		}
		this.#pending = boundedTail(this.#pending, MAX_PENDING_LINE_CHARS);
	}

	get text(): string {
		return this.#text;
	}
}

function boundedTail(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `[trimmed]\n${text.slice(-maxChars)}`;
}

function messageOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingProcess(cause: unknown): boolean {
	return isRecord(cause) && cause.code === "ESRCH";
}

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function trackExit(child: ChildProcess): ExitTracker {
	let settled = false;
	const promise = new Promise<SpawnSettlement>((resolve) => {
		// `close` fires after both stdio streams closed, so captured output is complete.
		child.once("close", (code, signal) => {
			settled = true;
			resolve({ code, signal });
		});
		child.once("error", (error: Error) => {
			settled = true;
			resolve({ code: null, signal: null, error });
		});
	});
	return { settled: promise, isSettled: () => settled };
}

function parseReadyLine(line: string): ReadyInfo | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.event !== READY_EVENT) return null;
	if (typeof value.origin !== "string" || typeof value.port !== "number") return null;
	if (typeof value.pid !== "number") return null;
	return { origin: value.origin, port: value.port, pid: value.pid };
}

function artifacts(stdout: StdioCapture, stderr: StdioCapture): string {
	return `--- host stdout ---\n${stdout.text}\n--- host stderr ---\n${stderr.text}`;
}

function notesSection(notes: readonly string[]): string {
	return notes.length === 0 ? "" : `\n${notes.join("\n")}`;
}

/** Issues the shutdown notice synchronously; async stream failures land in the notes. */
function requestShutdown(child: ChildProcess, notes: string[]): void {
	const stdin = child.stdin;
	if (!stdin) {
		notes.push("stdin is not piped");
		return;
	}
	stdin.write(SHUTDOWN_NOTICE, (error?: Error | null) => {
		if (error) notes.push(`shutdown notice failed: ${error.message}`);
	});
	stdin.end();
}

/** Kills only the given child and waits one bounded grace period for its exit. */
async function killOwnChild(
	child: ChildProcess,
	tracker: ExitTracker,
	notes: string[],
): Promise<boolean> {
	if (!tracker.isSettled()) {
		try {
			child.kill("SIGKILL");
		} catch (cause) {
			if (!tracker.isSettled() && !isMissingProcess(cause)) {
				notes.push(`SIGKILL failed: ${messageOf(cause)}`);
			}
		}
	}
	return await withTimeout(
		tracker.settled.then(() => true),
		KILL_TIMEOUT_MS,
		`no exit within ${KILL_TIMEOUT_MS} ms after SIGKILL`,
	).catch((cause: unknown) => {
		notes.push(messageOf(cause));
		return false;
	});
}

/**
 * One bounded stop attempt: notify on stdin, wait for exit, then kill only this child. The
 * graceful path needs the child to exit on its own; a required kill is reported as a failure
 * together with the captured output.
 */
async function stopOwnChild(
	child: ChildProcess,
	tracker: ExitTracker,
	context: string,
	stdout: StdioCapture,
	stderr: StdioCapture,
	streamNotes: readonly string[],
): Promise<number | null> {
	const notes: string[] = [...streamNotes];
	if (!tracker.isSettled()) requestShutdown(child, notes);
	const graceful = await withTimeout(
		tracker.settled,
		SHUTDOWN_TIMEOUT_MS,
		`no exit within ${SHUTDOWN_TIMEOUT_MS} ms after shutdown`,
	).catch((cause: unknown) => {
		notes.push(messageOf(cause));
		return null;
	});
	if (graceful) {
		if (graceful.error) {
			throw new Error(
				`${context} failed: ${graceful.error.message}\n${artifacts(stdout, stderr)}`,
			);
		}
		return graceful.code;
	}
	const killed = await killOwnChild(child, tracker, notes);
	const reason = killed
		? `${context} required SIGKILL to stop`
		: `${context} did not exit after SIGKILL`;
	throw new Error(`${reason}${notesSection(notes)}\n${artifacts(stdout, stderr)}`);
}

function hostArgs(options: StartHostOptions, port: number): readonly string[] {
	return [
		"run",
		"-A",
		HOST_ENTRY,
		"--data-dir",
		options.dataDir,
		"--token",
		options.token,
		"--port",
		String(port),
		"--dist-dir",
		options.distDir,
	];
}

/**
 * Starts one host process and waits for its readiness line. A non-zero requested port must be
 * the port the host reports, so a restart cannot silently move to another origin.
 */
export async function startSqliteHost(options: StartHostOptions): Promise<SqliteHost> {
	const requestedPort = options.port ?? 0;
	const child = spawn(
		options.launch?.file ?? process.env.RADIORA_DENO_BIN ?? "deno",
		[...(options.launch?.args ?? hostArgs(options, requestedPort))],
		{ stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
	);
	const context = `sqlite host (pid ${
		child.pid ?? "unknown"
	}, dataDir ${options.dataDir}, requested port ${requestedPort})`;
	const tracker = trackExit(child);
	let resolveReady: ((info: ReadyInfo) => void) | undefined;
	const ready = new Promise<ReadyInfo>((resolve) => {
		resolveReady = resolve;
	});
	const stdout = new StdioCapture((line) => {
		const info = parseReadyLine(line);
		if (info) resolveReady?.(info);
	});
	const stderr = new StdioCapture();
	// A stream error must never surface as an uncaught event in the Playwright worker.
	const streamNotes: string[] = [];
	child.stdin?.on("error", (error: Error) => streamNotes.push(`stdin error: ${error.message}`));
	child.stdout?.on("error", (error: Error) => streamNotes.push(`stdout error: ${error.message}`));
	child.stderr?.on("error", (error: Error) => streamNotes.push(`stderr error: ${error.message}`));
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => stdout.append(chunk));
	child.stderr?.on("data", (chunk: string) => stderr.append(chunk));

	const outcome = await withTimeout(
		Promise.race([
			ready.then((info) => ({ kind: "ready" as const, info })),
			tracker.settled.then((settlement) => ({ kind: "exited" as const, settlement })),
		]),
		options.readyTimeoutMs ?? READY_TIMEOUT_MS,
		`${context} did not report readiness`,
	).catch(async (cause: unknown) => {
		const notes: string[] = [...streamNotes];
		await killOwnChild(child, tracker, notes);
		return { kind: "timedOut" as const, cause, notes };
	});
	if (outcome.kind !== "ready") {
		const detail = outcome.kind === "exited"
			? `${context} exited before readiness with code ${outcome.settlement.code}` +
				(outcome.settlement.error ? `: ${outcome.settlement.error.message}` : "")
			: `${context} failed: ${messageOf(outcome.cause)}`;
		const notes = outcome.kind === "exited" ? [] : outcome.notes;
		throw new Error(`${detail}${notesSection(notes)}\n${artifacts(stdout, stderr)}`);
	}
	const info = outcome.info;
	if (requestedPort !== 0 && info.port !== requestedPort) {
		const notes: string[] = [...streamNotes];
		await killOwnChild(child, tracker, notes);
		throw new Error(
			`${context} reported port ${info.port} instead of the requested port${notesSection(notes)}\n${
				artifacts(stdout, stderr)
			}`,
		);
	}

	let stopPromise: Promise<number | null> | undefined;
	const stop = (): Promise<number | null> => {
		stopPromise ??= stopOwnChild(child, tracker, context, stdout, stderr, streamNotes);
		return stopPromise;
	};

	return {
		origin: info.origin,
		port: info.port,
		pid: info.pid,
		dataDir: options.dataDir,
		get stdout(): string {
			return stdout.text;
		},
		get stderr(): string {
			return stderr.text;
		},
		get exited(): boolean {
			return tracker.isSettled();
		},
		stop,
	};
}

async function removeOwnedRoot(root: string): Promise<void> {
	await rm(root, {
		recursive: true,
		force: true,
		maxRetries: REMOVE_MAX_RETRIES,
		retryDelay: REMOVE_RETRY_DELAY_MS,
	});
}

/**
 * Creates one attempt scope: an owned temp root, the port its first host reports, and every
 * host started through it. `cleanup` is the single closing rule — it owns in-flight starts,
 * stops every host they registered, then removes the root, and every caller awaits the same
 * promise. Late starts are rejected instead of racing the teardown, and an initialization
 * failure rolls back only the root this call created.
 */
export async function createSmokeAttempt(label: string): Promise<SmokeAttempt> {
	if (!/^[a-z0-9-]+$/i.test(label)) throw new Error(`Invalid attempt label: ${label}`);
	const root = await mkdtemp(join(tmpdir(), `radiora-smoke-${label}-`));
	try {
		const dataDir = join(root, "data");
		await mkdir(dataDir);
		const token = randomUUID();
		const hosts: SqliteHost[] = [];
		const inFlight = new Set<Promise<unknown>>();
		let assignedPort: number | undefined;
		let closing = false;
		let cleanupPromise: Promise<void> | undefined;

		async function startHost(distDir: string): Promise<SqliteHost> {
			const host = await startSqliteHost({ dataDir, token, distDir, port: assignedPort ?? 0 });
			if (closing) {
				// Cleanup began while this host was starting: stop it here so no live host survives.
				await host.stop();
				throw new Error(`attempt ${label} is cleaning up; the in-flight host was stopped`);
			}
			assignedPort ??= host.port;
			hosts.push(host);
			return host;
		}

		async function cleanupScope(): Promise<void> {
			closing = true;
			// A start still settling owns its host; let every one finish before stopping and removing.
			await Promise.allSettled([...inFlight]);
			let failure: unknown;
			for (const host of hosts.reverse()) {
				try {
					await host.stop();
				} catch (cause) {
					failure ??= cause;
				}
			}
			try {
				await removeOwnedRoot(root);
			} catch (cause) {
				failure ??= cause;
			}
			if (failure) throw failure;
		}

		return {
			root,
			dataDir,
			token,
			get port(): number | undefined {
				return assignedPort;
			},
			start(distDir: string): Promise<SqliteHost> {
				if (closing) {
					return Promise.reject(
						new Error(`attempt ${label} is cleaning up; start is not accepted`),
					);
				}
				const run = startHost(distDir);
				// Cleanup waits for every in-flight start; a failure belongs to the start's own caller.
				inFlight.add(run);
				return run;
			},
			cleanup(): Promise<void> {
				cleanupPromise ??= cleanupScope();
				return cleanupPromise;
			},
		};
	} catch (cause) {
		const rollback = await removeOwnedRoot(root).then(() => null, (failure: unknown) => failure);
		if (rollback) {
			throw new Error(`${messageOf(cause)} (rollback also failed: ${messageOf(rollback)})`, {
				cause,
			});
		}
		throw cause;
	}
}
