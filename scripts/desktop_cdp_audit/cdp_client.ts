export type JsonRecord = Record<string, unknown>;

interface CdpMessage {
	id?: number;
	method?: string;
	params?: JsonRecord;
	result?: JsonRecord;
	error?: JsonRecord;
}

interface PendingCommand {
	resolve: (message: CdpMessage) => void;
	reject: (cause: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const COMMAND_TIMEOUT_MS = 5_000;

export class CdpClient {
	readonly #socket: WebSocket;
	readonly #pending = new Map<number, PendingCommand>();
	readonly #listeners = new Map<string, Set<(params: JsonRecord) => void>>();
	readonly #connected: Promise<void>;
	#nextId = 0;

	constructor(webSocketUrl: string) {
		this.#socket = new WebSocket(webSocketUrl);
		this.#connected = new Promise<void>((resolve, reject) => {
			let opened = false;
			this.#socket.addEventListener("open", () => {
				opened = true;
				resolve();
			});
			this.#socket.addEventListener("error", () => {
				if (!opened) reject(new Error(`CDP WebSocket connection failed: ${webSocketUrl}`));
			});
		});
		this.#socket.addEventListener("message", (event) => this.#handleMessage(String(event.data)));
		this.#socket.addEventListener("close", () => {
			for (const pending of this.#pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error("CDP WebSocket closed before the command completed."));
			}
			this.#pending.clear();
		});
	}

	async ready(): Promise<void> {
		await this.#connected;
	}

	on(method: string, listener: (params: JsonRecord) => void): () => void {
		const listeners = this.#listeners.get(method) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(method, listeners);
		return () => listeners.delete(listener);
	}

	async send(method: string, params: JsonRecord = {}): Promise<CdpMessage> {
		await this.ready();
		const id = ++this.#nextId;
		return await new Promise<CdpMessage>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`CDP command timed out: ${method}`));
			}, COMMAND_TIMEOUT_MS);
			this.#pending.set(id, { resolve, reject, timer });
			try {
				this.#socket.send(JSON.stringify({ id, method, params }));
			} catch (cause) {
				clearTimeout(timer);
				this.#pending.delete(id);
				reject(asError(cause));
			}
		});
	}

	close(): void {
		this.#socket.close();
	}

	#handleMessage(raw: string): void {
		let message: CdpMessage;
		try {
			message = JSON.parse(raw) as CdpMessage;
		} catch {
			return;
		}
		if (typeof message.id === "number") {
			const pending = this.#pending.get(message.id);
			if (!pending) return;
			this.#pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) {
				pending.reject(new Error(`CDP ${message.error.message ?? "command failed"}`));
			} else {
				pending.resolve(message);
			}
			return;
		}
		if (!message.method) return;
		for (const listener of this.#listeners.get(message.method) ?? []) {
			listener(message.params ?? {});
		}
	}
}

export function asError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause));
}
