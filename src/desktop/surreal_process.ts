export type SurrealProcessLogger = (event: string, detail?: unknown) => void;

const pathSeparator = Deno.build.os === "windows" ? "\\" : "/";
const surrealCliName = Deno.build.os === "windows" ? "surreal.exe" : "surreal";
const surrealSidecarName = "radiora-surreal.exe";

export function surrealCommandCandidates(
	bundledSurrealDir: string | null,
	userProfile: string | null,
): string[] {
	return [
		...(Deno.build.os === "windows" && bundledSurrealDir
			? [`${bundledSurrealDir}${pathSeparator}${surrealSidecarName}`]
			: []),
		...(bundledSurrealDir ? [`${bundledSurrealDir}${pathSeparator}${surrealCliName}`] : []),
		"surreal",
		...(userProfile
			? [`${userProfile}${pathSeparator}.surrealdb${pathSeparator}${surrealCliName}`]
			: []),
	];
}

export type SurrealCommandProbe = (command: string) => Promise<boolean>;

export async function findSurrealCommand(
	candidates: readonly string[],
	probe: SurrealCommandProbe,
): Promise<string> {
	for (const command of candidates) {
		try {
			if (await probe(command)) return command;
			// biome-ignore lint/plugin/noSwallowedRejection: A failed executable probe means this candidate is unavailable; the next candidate is tried.
		} catch {
			// Try the next known installation location.
		}
	}
	const homeDir = Deno.build.os === "windows" ? "%USERPROFILE%\\" : "$HOME/";
	throw new Error(
		`SurrealDB CLI 3.x が見つかりません。bundle内・PATH・${homeDir}.surrealdbを確認してください。`,
	);
}

function parentDirectory(path: string): string {
	const index = path.lastIndexOf(pathSeparator);
	return index < 0 ? "." : path.slice(0, index);
}

export class SurrealProcess {
	#process: Deno.ChildProcess | null = null;
	#statusPromise: Promise<Deno.CommandStatus> | null = null;
	#exitStatus: Deno.CommandStatus | null = null;
	#outputTasks: Promise<void>[] = [];
	#stopping = false;

	constructor(
		private readonly dataPath: string,
		private readonly host = "127.0.0.1",
		private readonly port = 8012,
		private readonly diagnosticLogger?: SurrealProcessLogger,
		private readonly bundledSurrealDir?: string,
	) {}

	get endpoint(): string {
		return `ws://${this.host}:${this.port}`;
	}

	async start(): Promise<void> {
		this.trace("process.start.begin", { endpoint: this.endpoint, dataPath: this.dataPath });
		const command = await this.findCommand();
		await this.assertPortAvailable();
		this.trace("process.spawn.begin", { command });
		this.#stopping = false;
		this.#exitStatus = null;
		const args = [
			"start",
			"--user",
			"root",
			"--pass",
			"root",
			"--bind",
			`${this.host}:${this.port}`,
			`rocksdb:${this.dataPath}`,
		];
		this.#process = new Deno.Command(command, {
			args,
			cwd: Deno.build.os === "windows" ? parentDirectory(this.dataPath) : undefined,
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
		}).spawn();
		this.trace("process.spawn.ready", {
			pid: this.#process.pid,
			sidecar: Deno.build.os === "windows",
		});
		this.#outputTasks = [
			this.relayOutput(this.#process.stdout, "stdout"),
			this.relayOutput(this.#process.stderr, "stderr"),
		];
		this.#statusPromise = this.#process.status.then((status) => {
			this.#exitStatus = status;
			this.trace(this.#stopping ? "process.exit.ready" : "process.exit.unexpected", {
				code: status.code,
				success: status.success,
				signal: status.signal,
			});
			return status;
		});
		try {
			await this.waitUntilReady();
			this.trace("process.start.ready");
		} catch (cause) {
			await this.stop();
			throw cause;
		}
	}

	async stop(): Promise<void> {
		this.trace("process.stop.begin");
		const process = this.#process;
		const statusPromise = this.#statusPromise;
		this.#process = null;
		this.#statusPromise = null;
		if (!process) {
			this.trace("process.stop.ready", { alreadyStopped: true });
			return;
		}
		this.#stopping = true;
		if (Deno.build.os === "windows") {
			// biome-ignore lint/plugin/noSwallowedRejection: Closing stdin is best-effort because the child may already have exited.
			const stdinClose = process.stdin?.close().catch(() => undefined);
			if (stdinClose) {
				await Promise.race([
					stdinClose,
					new Promise<void>((resolve) => setTimeout(resolve, 750)),
				]);
			}
		}
		try {
			process.kill(Deno.build.os === "windows" ? "SIGKILL" : "SIGTERM");
			// biome-ignore lint/plugin/noSwallowedRejection: The managed process may already have exited before stop sends the signal.
		} catch {
			// It already exited.
		}
		await statusPromise?.catch(() => undefined);
		await Promise.allSettled(this.#outputTasks);
		this.#outputTasks = [];
		this.trace("process.stop.ready");
	}

	async findCommand(): Promise<string> {
		this.trace("process.command-check.begin");
		const bundledSurrealDir = this.bundledSurrealDir ?? parentDirectory(Deno.execPath());
		const homeDir = Deno.env.get(Deno.build.os === "windows" ? "USERPROFILE" : "HOME") ?? null;
		const candidates = surrealCommandCandidates(bundledSurrealDir, homeDir);
		return await findSurrealCommand(candidates, async (command) => {
			const output = await new Deno.Command(command, {
				args: ["version"],
				stdout: "piped",
				stderr: "piped",
			}).output();
			if (output.success) {
				this.trace("process.command-check.ready", {
					command,
					version: new TextDecoder().decode(output.stdout).trim(),
				});
			}
			return output.success;
		});
	}

	private async assertPortAvailable(): Promise<void> {
		this.trace("process.port-check.begin", { endpoint: this.endpoint });
		try {
			const listener = Deno.listen({ hostname: this.host, port: this.port });
			listener.close();
			this.trace("process.port-check.ready");
		} catch (cause) {
			throw new Error(
				`ポート ${this.port} は既に使用中です。既存のSurrealDBを終了して再試行してください。`,
				{ cause },
			);
		}
	}

	private async waitUntilReady(): Promise<void> {
		this.trace("process.health.begin");
		for (let attempt = 1; attempt <= 150; attempt++) {
			if (this.#exitStatus) {
				throw new Error(
					`SurrealDBがreadyになる前に終了しました (exit code ${this.#exitStatus.code})。`,
				);
			}
			try {
				const response = await fetch(`http://${this.host}:${this.port}/health`);
				if (response.ok) {
					this.trace("process.health.ready", { attempt });
					return;
				}
				// biome-ignore lint/plugin/noSwallowedRejection: Connection failures are expected while the bounded readiness poll is starting.
			} catch {
				// Still starting.
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error("SurrealDBが30秒以内にreadyになりませんでした。");
	}

	private async relayOutput(
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
					if (pending) this.trace(`process.${channel}`, pending);
					return;
				}
				pending += decoder.decode(value, { stream: true });
				const lines = pending.split(/\r?\n/);
				pending = lines.pop() ?? "";
				for (const line of lines) {
					if (line) this.trace(`process.${channel}`, line);
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private trace(event: string, detail?: unknown): void {
		try {
			this.diagnosticLogger?.(event, detail);
			// biome-ignore lint/plugin/noSwallowedRejection: Optional diagnostics must never change managed-process behavior.
		} catch {
			// Diagnostics must never change process behavior.
		}
	}
}
