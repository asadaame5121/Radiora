export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface LogEntry extends LogFields {
	timestamp: string;
	level: LogLevel;
	event: string;
}

export interface LoggerOptions {
	sink?: (line: string) => void;
	stdout?: (line: string) => void;
	selectRecord?: (entry: LogEntry) => LogEntry | null;
	now?: () => string;
	monotonicNow?: () => number;
	minLevel?: LogLevel;
}

const levelRank: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const releaseOperations = new Set([
	"createItem",
	"quickCapture",
	"moveItem",
	"createLink",
	"deleteItem",
	"searchItems",
	"runRuleQuery",
]);

export function selectLogRecord(
	profile: "development" | "release",
	entry: LogEntry,
): LogEntry | null {
	const { level, event } = entry;
	const safe = safeLogFields(entry);
	if (profile === "development") {
		if (event === "renderer.log") return null;
		if (level !== "error" && level !== "warn") return safe;
	}
	if (level === "warn" || level === "error") {
		return { ...safe, ...safeErrorName(entry.error) };
	}
	if (
		event !== "rpc.request" || typeof entry.method !== "string" ||
		!releaseOperations.has(entry.method)
	) return null;
	return safe;
}

function safeLogFields(entry: LogEntry): LogEntry {
	const { timestamp, level, event } = entry;
	return {
		timestamp,
		level,
		event,
		...(typeof entry.method === "string" ? { method: entry.method } : {}),
		...(typeof entry.durationMs === "number" ? { durationMs: entry.durationMs } : {}),
		...(entry.outcome === "ok" || entry.outcome === "error" ? { outcome: entry.outcome } : {}),
	};
}

function safeErrorName(error: unknown): { error: { name: string } } | Record<string, never> {
	if (typeof error !== "object" || error === null || !("name" in error)) return {};
	const name = error.name;
	if (typeof name !== "string") return {};
	return {
		error: {
			name: ["Error", "TypeError", "SyntaxError", "RangeError"].includes(name)
				? name
				: "OtherError",
		},
	};
}

export class Logger {
	readonly #sink: ((line: string) => void) | undefined;
	readonly #stdout: ((line: string) => void) | undefined;
	readonly #selectRecord: ((entry: LogEntry) => LogEntry | null) | undefined;
	readonly #now: () => string;
	readonly #monotonicNow: () => number;
	readonly #minLevel: LogLevel;

	constructor(options: LoggerOptions = {}) {
		this.#sink = options.sink;
		this.#stdout = options.stdout;
		this.#selectRecord = options.selectRecord;
		this.#now = options.now ?? (() => new Date().toISOString());
		this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
		this.#minLevel = options.minLevel ?? "debug";
	}

	debug(event: string, fields: LogFields = {}): LogEntry {
		return this.log("debug", event, fields);
	}

	info(event: string, fields: LogFields = {}): LogEntry {
		return this.log("info", event, fields);
	}

	warn(event: string, fields: LogFields = {}): LogEntry {
		return this.log("warn", event, fields);
	}

	error(event: string, cause?: unknown, fields: LogFields = {}): LogEntry {
		return this.log("error", event, {
			...fields,
			...(cause === undefined ? {} : { error: serializeCause(cause) }),
		});
	}

	log(level: LogLevel, event: string, fields: LogFields = {}): LogEntry {
		const entry: LogEntry = {
			...fields,
			timestamp: this.#now(),
			level,
			event,
		};
		if (levelRank[level] < levelRank[this.#minLevel]) return entry;
		const selected = this.#selectRecord ? this.#selectRecord(entry) : entry;
		if (!selected) return entry;

		const line = stringifyLogEntry(selected);
		try {
			this.#sink?.(line);
			// biome-ignore lint/plugin/noSwallowedRejection: A diagnostic sink is isolated so it cannot change application behavior.
		} catch {
			// Diagnostics must not change application behavior.
		}
		try {
			this.#stdout?.(line);
			// biome-ignore lint/plugin/noSwallowedRejection: Optional diagnostic stdout is isolated from application behavior.
		} catch {
			// Diagnostics must not change application behavior.
		}
		return entry;
	}

	timed<T>(
		event: string,
		operation: () => PromiseLike<T>,
		fields?: LogFields,
	): Promise<T>;

	timed<T>(
		event: string,
		operation: () => T,
		fields?: LogFields,
	): T;

	timed<T>(
		event: string,
		operation: () => T | PromiseLike<T>,
		fields: LogFields = {},
	): T | Promise<T> {
		const startedAt = this.#monotonicNow();
		const finish = (outcome: "ok" | "error", cause?: unknown): void => {
			const durationMs = Math.round(Math.max(0, this.#monotonicNow() - startedAt) * 100) / 100;
			const resultFields = { ...fields, durationMs, outcome };
			if (outcome === "error") this.error(event, cause, resultFields);
			else this.info(event, resultFields);
		};

		try {
			const result = operation();
			if (isPromiseLike(result)) {
				return Promise.resolve(result).then(
					(value) => {
						finish("ok");
						return value;
					},
					(cause) => {
						finish("error", cause);
						throw cause;
					},
				);
			}
			finish("ok");
			return result;
		} catch (cause) {
			finish("error", cause);
			throw cause;
		}
	}
}

export function stringifyLogEntry(entry: LogEntry): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(entry, (_key, value: unknown) => {
		if (typeof value === "bigint") return `${value}n`;
		if (value instanceof Error) return serializeCause(value);
		if (typeof value === "object" && value !== null) {
			if (seen.has(value)) return "[Circular]";
			seen.add(value);
		}
		return value;
	});
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return typeof value === "object" && value !== null && "then" in value &&
		typeof value.then === "function";
}

function serializeCause(cause: unknown): unknown {
	if (cause instanceof Error) {
		return {
			name: cause.name,
			message: cause.message,
			...(cause.stack ? { stack: cause.stack } : {}),
		};
	}
	return cause;
}
