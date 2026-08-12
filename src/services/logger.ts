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

export class Logger {
	readonly #sink: ((line: string) => void) | undefined;
	readonly #stdout: ((line: string) => void) | undefined;
	readonly #now: () => string;
	readonly #monotonicNow: () => number;
	readonly #minLevel: LogLevel;

	constructor(options: LoggerOptions = {}) {
		this.#sink = options.sink;
		this.#stdout = options.stdout;
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

		const line = stringifyLogEntry(entry);
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
