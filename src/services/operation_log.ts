import type { OperationRecord, OperationSummary } from "../shared/operation_log_types.ts";

const RETENTION_DAYS = 30;
// biome-ignore lint/style/noMagicNumbers: Log storage limits are expressed in mebibytes.
const MAX_BYTES = 20 * 1024 * 1024;
// biome-ignore lint/style/noMagicNumbers: Retention compares millisecond timestamps.
const DAY_MS = 24 * 60 * 60 * 1000;
// biome-ignore lint/style/noMagicNumbers: Rotate individual log files at five mebibytes.
const FILE_BYTES = 5 * 1024 * 1024;
const DURATION_DECIMAL_PLACES = 100;
const RECENT_RECORD_LIMIT = 20;
const operationFile = /^operation-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;
const diagnosticFile = /^startup(?:-(\d{4}-\d{2}-\d{2})(?:-(\d+))?)?\.log$/;

function fileInfoOrNull(path: string): Deno.FileInfo | null {
	try {
		return Deno.statSync(path);
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return null;
		throw cause;
	}
}

function ensureLogDir(dir: string): void {
	Deno.mkdirSync(dir, { recursive: true });
}

function entries(dir: string, pattern: RegExp): { name: string; size: number; modified: number }[] {
	const result: { name: string; size: number; modified: number }[] = [];
	for (const entry of Deno.readDirSync(dir)) {
		if (!entry.isFile || !pattern.test(entry.name)) continue;
		const stat = Deno.statSync(`${dir}/${entry.name}`);
		result.push({ name: entry.name, size: stat.size, modified: stat.mtime?.getTime() ?? 0 });
	}
	return result.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name));
}

function prune(dir: string, pattern: RegExp, now: number): void {
	const files = entries(dir, pattern);
	let bytes = files.reduce((total, file) => total + file.size, 0);
	for (const file of files) {
		if (file.modified >= now - RETENTION_DAYS * DAY_MS && bytes <= MAX_BYTES) continue;
		Deno.removeSync(`${dir}/${file.name}`);
		bytes -= file.size;
	}
}

export class OperationLog {
	readonly #dir: string;
	readonly #sessionId = crypto.randomUUID();
	readonly #now: () => Date;

	constructor(dir: string, now: () => Date = () => new Date()) {
		this.#dir = dir;
		this.#now = now;
		ensureLogDir(dir);
		prune(dir, operationFile, now().getTime());
	}

	record(event: string, outcome: "ok" | "error", durationMs = 0, errorType?: string): void {
		const timestamp = this.#now().toISOString();
		const record: OperationRecord = {
			timestamp,
			sessionId: this.#sessionId,
			event,
			outcome,
			durationMs: Math.round(Math.max(0, durationMs) * DURATION_DECIMAL_PLACES) /
				DURATION_DECIMAL_PLACES,
			...(outcome === "error" && errorType ? { errorType: safeErrorType(errorType) } : {}),
		};
		const day = timestamp.slice(0, 10);
		let index = 0;
		let path = `${this.#dir}/operation-${day}.jsonl`;
		while (true) {
			const stat = fileInfoOrNull(path);
			if (!stat || stat.size < FILE_BYTES) break;
			index++;
			path = `${this.#dir}/operation-${day}-${index}.jsonl`;
		}
		Deno.writeTextFileSync(path, `${JSON.stringify(record)}\n`, { append: true, create: true });
		prune(this.#dir, operationFile, this.#now().getTime());
	}

	exportJsonl(): string {
		prune(this.#dir, operationFile, this.#now().getTime());
		return entries(this.#dir, operationFile).map((file) =>
			Deno.readTextFileSync(`${this.#dir}/${file.name}`)
		).join("");
	}

	summary(): OperationSummary {
		const lines = this.exportJsonl().split("\n");
		const byDay = new Map<string, number>();
		const byEvent = new Map<string, number>();
		const recent: OperationRecord[] = [];
		let count = 0;
		let failed = 0;
		let duration = 0;
		for (const line of lines) {
			if (!line) continue;
			let record: unknown;
			try {
				record = JSON.parse(line);
			} catch {
				continue; // An interrupted final write must not break the log viewer.
			}
			if (!isOperationRecord(record)) continue;
			count++;
			if (record.outcome === "error") failed++;
			duration += record.durationMs;
			const day = record.timestamp.slice(0, 10);
			byDay.set(day, (byDay.get(day) ?? 0) + 1);
			byEvent.set(record.event, (byEvent.get(record.event) ?? 0) + 1);
			recent.push(record);
			if (recent.length > RECENT_RECORD_LIMIT) recent.shift();
		}
		return {
			retentionDays: RETENTION_DAYS,
			bytes: entries(this.#dir, operationFile).reduce((sum, file) => sum + file.size, 0),
			count,
			failed,
			averageDurationMs: count ? Math.round(duration / count) : 0,
			byDay: [...byDay].map(([day, count]) => ({ day, count })),
			byEvent: [...byEvent].map(([event, count]) => ({ event, count })).sort((a, b) =>
				b.count - a.count
			),
			recent: recent.reverse(),
		};
	}

	clearAll(): void {
		for (const file of entries(this.#dir, operationFile)) {
			Deno.removeSync(`${this.#dir}/${file.name}`);
		}
		for (const file of entries(this.#dir, diagnosticFile)) {
			Deno.removeSync(`${this.#dir}/${file.name}`);
		}
	}
}

function safeErrorType(value: string): string {
	return ["Error", "TypeError", "SyntaxError", "RangeError"].includes(value) ? value : "OtherError";
}

function isOperationRecord(value: unknown): value is OperationRecord {
	if (typeof value !== "object" || value === null) return false;
	return "timestamp" in value && typeof value.timestamp === "string" &&
		"sessionId" in value && typeof value.sessionId === "string" &&
		"event" in value && typeof value.event === "string" &&
		"outcome" in value && (value.outcome === "ok" || value.outcome === "error") &&
		"durationMs" in value && typeof value.durationMs === "number";
}

export class DiagnosticLogFiles {
	readonly #dir: string;
	readonly #now: () => Date;
	constructor(dir: string, now: () => Date = () => new Date()) {
		this.#dir = dir;
		this.#now = now;
		ensureLogDir(dir);
		const marker = `${dir}/diagnostics-sanitized-v1`;
		try {
			Deno.statSync(marker);
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) throw cause;
			for (const file of entries(dir, diagnosticFile)) Deno.removeSync(`${dir}/${file.name}`);
			Deno.writeTextFileSync(marker, "");
		}
		this.#rotate();
		prune(dir, diagnosticFile, now().getTime());
	}

	write(line: string): void {
		this.#rotate();
		Deno.writeTextFileSync(`${this.#dir}/startup.log`, `${line}\n`, { append: true, create: true });
		prune(this.#dir, diagnosticFile, this.#now().getTime());
	}

	#rotate(): void {
		const path = `${this.#dir}/startup.log`;
		const stat = fileInfoOrNull(path);
		if (!stat) return;
		const day = (stat.mtime ?? this.#now()).toISOString().slice(0, 10);
		if (day === this.#now().toISOString().slice(0, 10) && stat.size < FILE_BYTES) return;
		let index = 0;
		let archive = `${this.#dir}/startup-${day}.log`;
		while (fileInfoOrNull(archive)) {
			archive = `${this.#dir}/startup-${day}-${++index}.log`;
		}
		Deno.renameSync(path, archive);
	}
}
