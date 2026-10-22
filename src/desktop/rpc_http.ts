/**
 * Shared HTTP RPC boundary for `POST /api/rpc/<method>`.
 *
 * The desktop entry (`src/main.ts`) and future test-only hosts route requests through this
 * module so method dispatch, wire validation, and the response envelopes stay identical.
 * Host diagnostics (request timing, operation log, lazy startup bootstrap) arrive through
 * {@link RpcHttpPorts}; this module has no dependency on the desktop window, logger, or storage.
 */

export const RPC_PATH_PREFIX = "/api/rpc/";

const STARTUP_STATUS_METHOD = "getStartupStatus";
const UNKNOWN_METHOD_MESSAGE = "Unknown API method.";
const INVALID_BODY_MESSAGE = "Invalid RPC request body.";
const NOT_FOUND_STATUS = 404;
const BAD_REQUEST_STATUS = 400;
const SERVER_ERROR_STATUS = 500;

/** Binding handlers exposed over HTTP, keyed by RPC method name. */
export type RpcHandlers = Record<string, unknown>;

/** One invocation attempt observed at the transport boundary. */
export interface RpcOperationRecord {
	method: string;
	outcome: "ok" | "error";
	durationMs: number;
	errorName?: string;
}

export interface RpcHttpPorts {
	/** Real binding handlers. Unknown, inherited, and prototype names are never invoked. */
	handlers: RpcHandlers;
	/**
	 * Receives every attempt of a method the host tracks. The host owns the method-to-event
	 * mapping, decides which methods are tracked, and must not throw: this boundary does not
	 * isolate recorder failures, so a throwing recorder escapes the response envelope.
	 */
	recordOperation(record: RpcOperationRecord): void;
	/**
	 * Wraps one invocation so the host can measure requests selectively. Hosts that do not
	 * measure can return `invoke()` directly. A hook that rejects before invoking the handler
	 * is answered with the 500 envelope and never reaches the handler.
	 */
	measureRequest<T>(method: string, invoke: () => Promise<T>): Promise<T>;
	/** Called for a valid startup-status poll while startup is still pending. */
	onStartupStatusPoll?: () => void;
}

/** Malformed transport input; answered with 400 instead of the 500 handler envelope. */
class RpcRequestFormatError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "RpcRequestFormatError";
	}
}

/** Callable view of a binding record member; wire arguments still need handler-level validation. */
type RpcCallable = (...args: unknown[]) => unknown;

/**
 * Resolves one own member of the binding record to its callable view. Unknown names,
 * inherited and prototype members, and non-callable values all resolve to undefined.
 */
function resolveCallable(handlers: RpcHandlers, method: string): RpcCallable | undefined {
	const candidate = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
	if (typeof candidate !== "function") return undefined;
	// Bindings declare narrower parameter types than the boundary can name and validate their
	// own arguments, so only callability is verified here before re-typing the value.
	return candidate as RpcCallable;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new RpcRequestFormatError(INVALID_BODY_MESSAGE, { cause });
	}
}

/**
 * Reads `{ args }` from the request body. Only a JSON object is accepted; `{}` and a null `args`
 * mean "no arguments". An absent, empty, or non-object body and a non-array `args` are
 * rejected before a handler can run.
 */
async function readRequestArgs(request: Request): Promise<unknown[]> {
	const text = await request.text();
	if (text.trim() === "") throw new RpcRequestFormatError(INVALID_BODY_MESSAGE);
	const body = parseJson(text);
	if (!isJsonObject(body)) throw new RpcRequestFormatError(INVALID_BODY_MESSAGE);
	const args = body.args;
	if (args === undefined || args === null) return [];
	if (!Array.isArray(args)) throw new RpcRequestFormatError(INVALID_BODY_MESSAGE);
	return args;
}

function unknownMethodResponse(): Response {
	return Response.json({ message: UNKNOWN_METHOD_MESSAGE }, { status: NOT_FOUND_STATUS });
}

function errorResponse(cause: unknown): Response {
	const message = cause instanceof Error ? cause.message : String(cause);
	const status = cause instanceof RpcRequestFormatError ? BAD_REQUEST_STATUS : SERVER_ERROR_STATUS;
	return Response.json({ message }, { status });
}

/**
 * Builds the handler for the `/api/rpc/` branch. Callers route by {@link RPC_PATH_PREFIX};
 * renderer-log, asset, and HMR routes stay outside this module.
 */
export function createRpcHttpHandler(ports: RpcHttpPorts): (request: Request) => Promise<Response> {
	const { handlers, recordOperation, measureRequest, onStartupStatusPoll } = ports;
	return async (request) => {
		const method = new URL(request.url).pathname.slice(RPC_PATH_PREFIX.length);
		const handler = resolveCallable(handlers, method);
		if (request.method !== "POST" || handler === undefined) {
			return unknownMethodResponse();
		}
		const started = performance.now();
		try {
			const result = await measureRequest(method, async () => {
				const args = await readRequestArgs(request);
				if (method === STARTUP_STATUS_METHOD) onStartupStatusPoll?.();
				return await handler(...args);
			});
			recordOperation({ method, outcome: "ok", durationMs: performance.now() - started });
			return Response.json({ result: result ?? null });
		} catch (cause) {
			recordOperation({
				method,
				outcome: "error",
				durationMs: performance.now() - started,
				errorName: cause instanceof Error ? cause.name : "UnknownError",
			});
			return errorResponse(cause);
		}
	};
}
