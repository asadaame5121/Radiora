type JsonRecord = Record<string, unknown>;
type TargetKind = "renderer" | "deno";

interface CdpTarget {
	id?: string;
	type?: string;
	title?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
}

interface InspectorVersion {
	Browser?: string;
	webSocketDebuggerUrl?: string;
}

interface AuditOptions {
	host: string;
	port: number;
	target: TargetKind;
	waitMs: number;
	expression?: string;
	screenshot?: string;
	strict: boolean;
}

interface AuditEvents {
	console: JsonRecord[];
	exceptions: JsonRecord[];
	logs: JsonRecord[];
	failedRequests: JsonRecord[];
}

interface InspectorState {
	baseUrl: string;
	version: InspectorVersion;
	targets: CdpTarget[];
}

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

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9230;
const COMMAND_TIMEOUT_MS = 5_000;

class CdpClient {
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

const options = parseOptions(Deno.args);
if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
	printHelp();
} else {
	try {
		const report = await runAudit(options);
		console.log(JSON.stringify(report, null, 2));
		if (options.strict && report.issueCount > 0) Deno.exit(2);
	} catch (cause) {
		console.error(`Desktop CDP audit failed: ${asError(cause).message}`);
		Deno.exit(1);
	}
}

async function runAudit(options: AuditOptions): Promise<JsonRecord & { issueCount: number }> {
	const inspector = await discoverInspector(options);
	const candidates = endpointCandidates(options.target, inspector);
	const { client, webSocketUrl } = await connectToFirst(candidates);
	const events: AuditEvents = {
		console: [],
		exceptions: [],
		logs: [],
		failedRequests: [],
	};
	client.on("Runtime.consoleAPICalled", (params) => events.console.push(consoleEvent(params)));
	client.on("Runtime.exceptionThrown", (params) => events.exceptions.push(exceptionEvent(params)));
	client.on("Log.entryAdded", (params) => events.logs.push(asRecord(params.entry)));
	client.on("Network.loadingFailed", (params) =>
		events.failedRequests.push({
			requestId: params.requestId,
			errorText: params.errorText,
			blockedReason: params.blockedReason ?? null,
		}));

	try {
		await client.send("Runtime.enable");
		await sendOptional(client, "Log.enable");
		if (options.target === "renderer") {
			await sendOptional(client, "Page.enable");
			await sendOptional(client, "Network.enable");
		}
		await wait(options.waitMs);
		const summary = await evaluate(client, summaryExpression(options.target));
		const expressionResult = options.expression ? await evaluate(client, options.expression) : null;
		const screenshot = options.screenshot && options.target === "renderer"
			? await captureScreenshot(client, options.screenshot)
			: null;
		const issueCount = events.console.filter((event) => event.type === "error").length +
			events.exceptions.length + events.failedRequests.length;
		return {
			generatedAt: new Date().toISOString(),
			targetKind: options.target,
			inspector: {
				baseUrl: inspector.baseUrl,
				browser: inspector.version.Browser ?? null,
				webSocketUrl,
				targets: inspector.targets,
			},
			summary,
			expression: options.expression
				? { source: options.expression, result: expressionResult }
				: null,
			console: events.console,
			exceptions: events.exceptions,
			logs: events.logs,
			failedRequests: events.failedRequests,
			screenshot,
			issueCount,
		};
	} finally {
		client.close();
	}
}

async function discoverInspector(options: AuditOptions): Promise<InspectorState> {
	const baseUrl = `http://${options.host}:${options.port}`;
	const version = await fetchJson<InspectorVersion>(`${baseUrl}/json/version`);
	let targets: CdpTarget[] = [];
	try {
		targets = await fetchJson<CdpTarget[]>(`${baseUrl}/json/list`);
		// biome-ignore lint/plugin/noSwallowedRejection: /json/list is optional on older inspector builds; /json/version is the fallback.
	} catch {
		// Older inspector builds may expose /json/version without /json/list.
	}
	return { baseUrl, version, targets };
}

function endpointCandidates(target: TargetKind, inspector: InspectorState): string[] {
	const page = inspector.targets.find((candidate) =>
		candidate.type === "page" && candidate.webSocketDebuggerUrl
	);
	const worker = inspector.targets.find((candidate) =>
		candidate.type === "worker" && candidate.webSocketDebuggerUrl
	);
	const muxPath = target === "renderer" ? "/cef" : "/deno";
	return unique([
		target === "renderer" ? page?.webSocketDebuggerUrl : worker?.webSocketDebuggerUrl,
		toWebSocketUrl(inspector.baseUrl, muxPath),
		inspector.version.webSocketDebuggerUrl,
	]);
}

async function connectToFirst(
	candidates: string[],
): Promise<{ client: CdpClient; webSocketUrl: string }> {
	let lastCause: unknown = new Error("No CDP WebSocket endpoint was advertised.");
	for (const webSocketUrl of candidates) {
		const client = new CdpClient(webSocketUrl);
		try {
			await client.ready();
			await client.send("Runtime.enable");
			return { client, webSocketUrl };
		} catch (cause) {
			lastCause = cause;
			client.close();
		}
	}
	throw new Error(`Unable to connect to the Deno Desktop inspector: ${asError(lastCause).message}`);
}

async function sendOptional(client: CdpClient, method: string): Promise<void> {
	try {
		await client.send(method);
		// biome-ignore lint/plugin/noSwallowedRejection: Optional CDP domains differ by target, and absence is an expected capability check.
	} catch {
		// The Deno and renderer targets expose different subsets of CDP domains.
	}
}

async function evaluate(client: CdpClient, expression: string): Promise<unknown> {
	const response = await client.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	});
	const result = asRecord(response.result);
	if (result.exceptionDetails) {
		throw new Error(
			`Runtime.evaluate failed: ${formatRemoteValue(asRecord(result.exceptionDetails).exception)}`,
		);
	}
	return formatRemoteValue(result.result);
}

async function captureScreenshot(client: CdpClient, path: string): Promise<string> {
	const response = await client.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
	});
	const data = asRecord(response.result).data;
	if (typeof data !== "string") throw new Error("Page.captureScreenshot returned no image data.");
	const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (separator > 0) await Deno.mkdir(path.slice(0, separator), { recursive: true });
	await Deno.writeFile(path, Uint8Array.from(atob(data), (character) => character.charCodeAt(0)));
	return path;
}

function summaryExpression(target: TargetKind): string {
	return target === "renderer"
		? `(() => ({
			title: document.title,
			url: location.href,
			readyState: document.readyState,
			bodyTextLength: document.body?.innerText?.length ?? 0,
			activeElement: document.activeElement?.tagName ?? null,
		}))()`
		: `({ version: Deno.version, memory: Deno.memoryUsage?.() ?? null })`;
}

function consoleEvent(params: JsonRecord): JsonRecord {
	return {
		type: params.type ?? "log",
		args: Array.isArray(params.args) ? params.args.map(formatRemoteValue) : [],
		stackTrace: params.stackTrace ?? null,
	};
}

function exceptionEvent(params: JsonRecord): JsonRecord {
	const details = asRecord(params.exceptionDetails);
	return {
		text: details.text ?? null,
		url: details.url ?? null,
		lineNumber: details.lineNumber ?? null,
		columnNumber: details.columnNumber ?? null,
		exception: formatRemoteValue(details.exception),
	};
}

function formatRemoteValue(value: unknown): unknown {
	if (!isRecord(value)) return value ?? null;
	if ("value" in value) return value.value;
	if ("unserializableValue" in value) return value.unserializableValue;
	if ("description" in value) return value.description;
	return value;
}

function parseOptions(args: string[]): AuditOptions {
	const options: AuditOptions = {
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		target: "renderer",
		waitMs: 500,
		strict: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") continue;
		if (arg === "--strict") {
			options.strict = true;
			continue;
		}
		const [flag, inlineValue] = arg.split("=", 2);
		const value = inlineValue ?? args[++index];
		if (!value) throw new Error(`Missing value for ${flag}`);
		switch (flag) {
			case "--host":
				options.host = value;
				break;
			case "--port":
				options.port = parsePositiveInteger(value, flag);
				break;
			case "--target":
				if (value !== "renderer" && value !== "deno") throw new Error(`Invalid target: ${value}`);
				options.target = value;
				break;
			case "--wait-ms":
				options.waitMs = parseNonNegativeInteger(value, flag);
				break;
			case "--expression":
				options.expression = value;
				break;
			case "--screenshot":
				options.screenshot = value;
				break;
			default:
				throw new Error(`Unknown option: ${flag}`);
		}
	}
	return options;
}

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer.`);
	}
	return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer.`);
	}
	return parsed;
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return await response.json() as T;
}

function toWebSocketUrl(baseUrl: string, path: string): string {
	const url = new URL(baseUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = path;
	url.search = "";
	return url.toString();
}

function unique(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function asRecord(value: unknown): JsonRecord {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function asError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause));
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printHelp(): void {
	console.log(`Usage: deno task desktop:audit [options]

Connects to a running Deno Desktop inspector and emits a JSON audit report.

Options:
  --host <host>             Inspector host (default: 127.0.0.1)
  --port <port>             Inspector port (default: 9230)
  --target <renderer|deno>  CDP target to inspect (default: renderer)
  --wait-ms <milliseconds>  Collect events for this long before evaluation
  --expression <source>     Evaluate an expression in the selected target
  --screenshot <path>       Save a renderer PNG (ignored for --target deno)
  --strict                  Exit with code 2 when issues are observed
  --help                    Show this help
`);
}
