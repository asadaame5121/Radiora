export type SurrealProcessLogger = (event: string, detail?: unknown) => void;

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
		this.#process = new Deno.Command(command, {
			args: [
				"start",
				"--user",
				"root",
				"--pass",
				"root",
				"--bind",
				`${this.host}:${this.port}`,
				`rocksdb:${this.dataPath}`,
			],
			stdout: "piped",
			stderr: "piped",
		}).spawn();
		this.trace("process.spawn.ready", { pid: this.#process.pid });
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
		try {
			process.kill(Deno.build.os === "windows" ? "SIGKILL" : "SIGTERM");
		} catch {
			// It already exited.
		}
		await statusPromise?.catch(() => undefined);
		await Promise.allSettled(this.#outputTasks);
		this.#outputTasks = [];
		this.trace("process.stop.ready");
	}

	private async findCommand(): Promise<string> {
		this.trace("process.command-check.begin");
		const userProfile = Deno.env.get("USERPROFILE");
		const candidates = [
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
				if (!output.success) continue;
				this.trace("process.command-check.ready", {
					command,
					version: new TextDecoder().decode(output.stdout).trim(),
				});
				return command;
			} catch {
				// Try the next known installation location.
			}
		}
		throw new Error(
			"SurrealDB CLI 3.x が見つかりません。PATHまたは%USERPROFILE%\\.surrealdbを確認してください。",
		);
	}

	private async assertPortAvailable(): Promise<void> {
		this.trace("process.port-check.begin", { endpoint: this.endpoint });
		try {
			const listener = Deno.listen({ hostname: this.host, port: this.port });
			listener.close();
			this.trace("process.port-check.ready");
		} catch {
			throw new Error(
				`ポート ${this.port} は既に使用中です。既存のSurrealDBを終了して再試行してください。`,
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
		} catch {
			// Diagnostics must never change process behavior.
		}
	}
}
