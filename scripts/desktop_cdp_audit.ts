import { asError, CdpClient, type JsonRecord } from "./desktop_cdp_audit/cdp_client.ts";
import { type AuditOptions, parseOptions, type TargetKind } from "./desktop_cdp_audit/options.ts";

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

interface AuditEvents {
	console: JsonRecord[];
	exceptions: JsonRecord[];
	logs: JsonRecord[];
	failedRequests: JsonRecord[];
	traceEvents: unknown[];
}

interface InspectorState {
	baseUrl: string;
	version: InspectorVersion;
	targets: CdpTarget[];
}

if (import.meta.main) {
	if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
		printHelp();
	} else {
		try {
			const options = parseOptions(Deno.args);
			const report = await runAudit(options);
			if (options.output) {
				await writeNewJsonFile(options.output, report);
				console.log(JSON.stringify(
					{
						outputPath: options.output,
						issueCount: report.issueCount,
						trace: report.trace,
					},
					null,
					2,
				));
			} else {
				console.log(JSON.stringify(report, null, 2));
			}
			if (options.strict && report.issueCount > 0) Deno.exit(2);
		} catch (cause) {
			console.error(`Desktop CDP audit failed: ${asError(cause).message}`);
			Deno.exit(1);
		}
	}
}

export async function runAudit(
	options: AuditOptions,
): Promise<JsonRecord & { issueCount: number }> {
	await Promise.all(
		[options.trace, options.output]
			.filter((path): path is string => path !== undefined)
			.map(assertFileDoesNotExist),
	);
	const { inspector, client, webSocketUrl } = await connectAudit(options);
	const { events, traceComplete } = registerAuditListeners(client, options.trace !== undefined);
	try {
		await client.send("Runtime.enable");
		await sendOptional(client, "Log.enable");
		if (options.target === "renderer") {
			await sendOptional(client, "Page.enable");
			await sendOptional(client, "Network.enable");
		}
		if (options.trace) {
			await client.send("Tracing.start", {
				traceConfig: {
					recordMode: "recordUntilFull",
					includedCategories: ["devtools.timeline", "blink.user_timing", "v8"],
				},
				transferMode: "ReportEvents",
			});
		}
		await wait(options.waitMs);
		const summary = await evaluate(client, summaryExpression(options.target));
		const expressionResult = options.expression ? await evaluate(client, options.expression) : null;
		const screenshot = options.screenshot && options.target === "renderer"
			? await captureScreenshot(client, options.screenshot)
			: null;
		const trace = await captureTrace(options, client, inspector, events, traceComplete);
		const issueCount = events.console.filter((event) => event.type === "error").length +
			events.exceptions.length + events.failedRequests.length +
			(trace?.dataLossOccurred === true ? 1 : 0);
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
			trace,
			issueCount,
		};
	} finally {
		client.close();
	}
}

async function connectAudit(options: AuditOptions) {
	const inspector = await discoverInspector(options);
	const candidates = endpointCandidates(options.target, inspector);
	const connection = await connectToFirst(candidates);
	return { inspector, ...connection };
}

function registerAuditListeners(client: CdpClient, traceEnabled: boolean) {
	let resolveTraceComplete: ((params: JsonRecord) => void) | undefined;
	const traceComplete = traceEnabled
		? new Promise<JsonRecord>((resolve) => resolveTraceComplete = resolve)
		: undefined;
	const events: AuditEvents = {
		console: [],
		exceptions: [],
		logs: [],
		failedRequests: [],
		traceEvents: [],
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
	client.on("Tracing.dataCollected", (params) => {
		if (Array.isArray(params.value)) events.traceEvents.push(...params.value);
	});
	client.on("Tracing.tracingComplete", (params) => resolveTraceComplete?.(params));
	return { events, traceComplete };
}

async function captureTrace(
	options: AuditOptions,
	client: CdpClient,
	inspector: InspectorState,
	events: AuditEvents,
	traceComplete: Promise<JsonRecord> | undefined,
): Promise<JsonRecord | null> {
	const tracePath = options.trace;
	if (!tracePath) return null;
	await client.send("Tracing.end");
	if (!traceComplete) throw new Error("Trace completion listener was not initialized.");
	const completed = await withTimeout(traceComplete, 30_000, "CDP tracing");
	await writeNewJsonFile(tracePath, {
		traceEvents: events.traceEvents,
		metadata: {
			targetKind: options.target,
			browser: inspector.version.Browser ?? null,
			generatedAt: new Date().toISOString(),
		},
	});
	return {
		path: tracePath,
		eventCount: events.traceEvents.length,
		dataLossOccurred: completed.dataLossOccurred === true,
	};
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

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function writeNewJsonFile(path: string, value: unknown): Promise<void> {
	const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (separator > 0) await Deno.mkdir(path.slice(0, separator), { recursive: true });
	await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, { createNew: true });
}

async function assertFileDoesNotExist(path: string): Promise<void> {
	try {
		await Deno.lstat(path);
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return;
		throw cause;
	}
	throw new Error(`Refusing to replace existing audit output: ${path}`);
}

async function withTimeout<T>(
	promise: Promise<T>,
	milliseconds: number,
	label: string,
): Promise<T> {
	return await new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${label} did not complete within ${milliseconds} ms.`)),
			milliseconds,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(cause) => {
				clearTimeout(timer);
				reject(cause);
			},
		);
	});
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
  --trace <path>            Save renderer Performance trace as Chrome trace JSON
  --output <path>           Save audit report JSON without replacing existing files
  --strict                  Exit with code 2 when issues are observed
  --help                    Show this help
`);
}
