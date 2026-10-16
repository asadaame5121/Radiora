/**
 * Node fixture for the full-stack smoke (`playwright.smoke.config.ts`).
 *
 * One attempt per test: a unique temp root, the port its first host reports, and the real test
 * host from `test_host_process.ts`. Backend artifacts are collected in one order for every
 * outcome — hosts stop first, then stdout/stderr plus the owned log files are attached, then
 * the owned root is removed — so a shutdown-time failure still leaves its final logs behind.
 * Nothing outside the owned root is read, and collection failures never replace the original
 * cause: they surface as their own diagnostics attachment and on stderr.
 */
import { test as base, type TestInfo } from "@playwright/test";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createSmokeAttempt, type SmokeAttempt, type SqliteHost } from "./test_host_process";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST_DIR = join(REPO_ROOT, "dist");
const LOG_DIR_NAME = "logs";
const ATTACHMENT_CAP = 200_000;
const OWNED_TREE_DEPTH = 4;

interface LifecycleFailure {
	readonly phase: string;
	readonly cause: unknown;
}

export interface SmokeSession {
	readonly origin: string;
	readonly port: number;
	readonly dataDir: string;
	/** Stops the current host (bounded), then starts a new one on the same root and port. */
	restart(): Promise<void>;
}

export const test = base.extend<{ smoke: SmokeSession }>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern for fixtures without dependencies.
	smoke: async ({}, use, testInfo) => {
		if (process.platform !== "win32") {
			throw new Error(
				"The full-stack smoke host runs on Windows only (its data directory layout uses backslash segments). See README.md.",
			);
		}
		const attempt = await createSmokeAttempt(attemptLabel(testInfo));
		const lifecycleFailures: LifecycleFailure[] = [];
		let host: SqliteHost | undefined;
		let attachedFailures = -1;

		const collectArtifacts = async (): Promise<void> => {
			// Re-collect when a new lifecycle failure arrived after an earlier complete pass.
			if (attachedFailures === lifecycleFailures.length) return;
			const failures = await attachBackendDiagnostics(
				testInfo,
				attempt,
				host,
				lifecycleFailures,
			);
			// Only a complete pass is final; an incomplete one stays retryable.
			attachedFailures = failures.length === 0 ? lifecycleFailures.length : -1;
			if (failures.length > 0) {
				console.error(`smoke diagnostics were incomplete:\n${failures.join("\n")}`);
			}
		};

		const setupFailure = await runTestBody();
		// The attempt owns the order: stop every host, collect the final artifacts once (success or
		// failure), then remove the root. A cleanup failure added after that collection is
		// appended by collecting again below.
		const cleanupFailure = await attempt.cleanup({ beforeRemove: collectArtifacts })
			.catch((cause: unknown) => cause);
		if (cleanupFailure !== undefined) {
			lifecycleFailures.push({ phase: "cleanup", cause: cleanupFailure });
		}
		if (setupFailure !== undefined && cleanupFailure !== undefined) {
			await collectArtifacts();
			// Neither failure hides the other: the setup error stays the cause.
			throw new Error(
				`${messageOf(setupFailure)} (cleanup also failed: ${messageOf(cleanupFailure)})`,
				{ cause: setupFailure },
			);
		}
		if (setupFailure !== undefined) throw setupFailure;
		if (cleanupFailure !== undefined) {
			await collectArtifacts();
			throw new Error(`smoke attempt cleanup failed: ${messageOf(cleanupFailure)}`, {
				cause: cleanupFailure,
			});
		}

		async function runTestBody(): Promise<unknown> {
			try {
				await requireBuiltDist();
				host = await attempt.start(DIST_DIR);
				await use({
					origin: host.origin,
					port: host.port,
					dataDir: attempt.dataDir,
					async restart(): Promise<void> {
						const previous = host;
						if (!previous) throw new Error("smoke host is not running");
						try {
							const code = await previous.stop();
							if (code !== 0) throw new Error(`smoke host stop returned ${code}`);
							host = await attempt.start(DIST_DIR);
						} catch (cause) {
							// Keep the failed restart's controller output for the lifecycle attachment; the
							// handle still points at the previous host, which is already stopped.
							lifecycleFailures.push({ phase: "restart", cause });
							throw cause;
						}
					},
				});
				return undefined;
			} catch (cause) {
				// Recorded only: the single post-stop collection below runs for every outcome.
				lifecycleFailures.push({ phase: "setup", cause });
				return cause;
			}
		}
	},
});

export { expect } from "@playwright/test";

function attemptLabel(testInfo: TestInfo): string {
	const id = testInfo.testId.replaceAll(/[^a-zA-Z0-9-]/g, "").slice(0, 24).toLowerCase();
	return `${id || "smoke"}-r${testInfo.retry}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only a missing path is benign; permission and I/O failures must surface. */
function isMissing(cause: unknown): boolean {
	return isRecord(cause) && cause.code === "ENOENT";
}

function messageOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

async function requireBuiltDist(): Promise<void> {
	const index = join(DIST_DIR, "index.html");
	try {
		await stat(index);
	} catch (cause) {
		throw new Error(
			`dist/index.html is missing at ${index}. Run "npm run build" or use "npm run test:smoke", which builds first.`,
			{ cause },
		);
	}
}

/** Best-effort collection: every failure is reported back and never replaces the test failure. */
async function attachBackendDiagnostics(
	testInfo: TestInfo,
	attempt: SmokeAttempt,
	host: SqliteHost | undefined,
	lifecycleFailures: readonly LifecycleFailure[],
): Promise<string[]> {
	const failures: string[] = [];
	const collect = async (name: string, read: () => Promise<string>): Promise<void> => {
		try {
			// One file per artifact under the test's output dir, then attach that file, so CI
			// artifacts and the report carry identical content.
			const path = testInfo.outputPath(name);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, await read());
			await testInfo.attach(name, { path, contentType: "text/plain" });
		} catch (cause) {
			failures.push(`${name}: ${messageOf(cause)}`);
		}
	};
	await collect("backend-stdout.log", async () => host?.stdout ?? "[backend did not start]");
	await collect("backend-stderr.log", async () => host?.stderr ?? "");
	if (lifecycleFailures.length > 0) {
		await collect(
			"backend-lifecycle-error.log",
			async () => lifecycleFailures.map(renderLifecycleFailure).join("\n\n"),
		);
	}
	let logFiles: string[] = [];
	try {
		logFiles = await ownedLogFiles(attempt.dataDir);
	} catch (cause) {
		// A listing failure is a diagnostic of its own; it never replaces the test failure.
		failures.push(`owned log listing: ${messageOf(cause)}`);
	}
	for (const file of logFiles) {
		await collect(`backend-${basename(file)}`, () => readFile(file, "utf8").then(bounded));
	}
	await collect(
		"backend-owned-files.txt",
		async () => (await ownedFiles(attempt.dataDir)).join("\n"),
	);
	if (failures.length > 0) {
		await collect("backend-diagnostics-error.log", async () => failures.join("\n"));
	}
	return failures;
}

function renderLifecycleFailure(failure: LifecycleFailure): string {
	return `[${failure.phase}] ${messageOf(failure.cause)}`;
}

/** Only files inside the owned data directory are ever collected. */
async function ownedLogFiles(dataDir: string): Promise<string[]> {
	const dir = join(dataDir, LOG_DIR_NAME);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (cause) {
		if (isMissing(cause)) return [];
		throw cause;
	}
	return names
		.filter((name) => name.endsWith(".log") || name.endsWith(".jsonl"))
		.map((name) => join(dir, name))
		.sort();
}

async function ownedFiles(root: string, depth = OWNED_TREE_DEPTH): Promise<string[]> {
	const found: string[] = [];
	const walk = async (dir: string, remaining: number): Promise<void> => {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (cause) {
			if (isMissing(cause)) return;
			throw cause;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			found.push(relative(root, path));
			if (entry.isDirectory() && remaining > 0) await walk(path, remaining - 1);
		}
	};
	await walk(root, depth);
	return found.sort();
}

function bounded(text: string): string {
	return text.length <= ATTACHMENT_CAP ? text : `[trimmed]\n${text.slice(-ATTACHMENT_CAP)}`;
}
