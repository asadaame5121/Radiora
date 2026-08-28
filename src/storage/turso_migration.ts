import type { GraphStateSnapshot } from "./graph_store.ts";
import { validatedGraphStateSnapshot } from "./graph_store.ts";
import {
	copyStoragePath,
	readStorageVersion,
	removeStoragePathIfExists,
	storageParentPath,
	storagePathExists,
} from "./migration_backup.ts";
import { SqliteGraphStore } from "./sqlite_store.ts";

export const TURSO_MIGRATION_MARKER_VERSION = 1;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;
const BACKUP_FINGERPRINT_LENGTH = 16;

export interface TursoMigrationMarker {
	markerVersion: 1;
	sourcePath: string;
	sourceStorageVersion: number;
	sourceFingerprint: string;
	snapshotHash: string;
	backupPath: string;
	migratedAt: string;
}

export interface TursoMigrationResult {
	backupPath: string;
	sourceFingerprint: string;
	sourceStorageVersion: number;
	snapshotHash: string;
	markerPath: string;
}

export interface LegacyStorageMigrationOptions {
	sourcePath: string;
	sourceVersionMarkerPath: string;
	backupRoot: string;
	targetPath: string;
	markerPath: string;
	exportSnapshot: (copyPath: string) => Promise<GraphStateSnapshot>;
}

export async function migrateLegacyStorageToTurso(
	options: LegacyStorageMigrationOptions,
): Promise<TursoMigrationResult | null> {
	if (!(await storagePathExists(options.sourcePath))) return null;
	const marker = await readMigrationMarker(options.markerPath);
	if (await storagePathExists(options.targetPath)) {
		if (marker?.sourcePath === options.sourcePath) return null;
		throw new Error(
			`Turso migration target exists without a valid completion marker: ${options.targetPath}`,
		);
	}

	const sourceStorageVersion = await readStorageVersion(options.sourceVersionMarkerPath);
	const sourceFingerprint = await fingerprintStoragePath(options.sourcePath);
	const backupPath = await createColdBackup(
		options.sourcePath,
		options.backupRoot,
		sourceStorageVersion,
		sourceFingerprint,
	);
	const copyPath = `${options.sourcePath}.turso-migration-${crypto.randomUUID()}`;
	await copyStoragePath(options.sourcePath, copyPath);
	try {
		const snapshot = validatedGraphStateSnapshot(await options.exportSnapshot(copyPath));
		const imported = await importGraphStateToTurso(snapshot, options.targetPath);
		const marker: TursoMigrationMarker = {
			markerVersion: TURSO_MIGRATION_MARKER_VERSION,
			sourcePath: options.sourcePath,
			sourceStorageVersion,
			sourceFingerprint,
			snapshotHash: imported.snapshotHash,
			backupPath,
			migratedAt: new Date().toISOString(),
		};
		await writeJsonAtomically(options.markerPath, marker);
		return {
			backupPath,
			sourceFingerprint,
			sourceStorageVersion,
			snapshotHash: imported.snapshotHash,
			markerPath: options.markerPath,
		};
	} finally {
		await removeStoragePathIfExists(copyPath, true);
	}
}

export async function importGraphStateToTurso(
	snapshot: GraphStateSnapshot,
	targetPath: string,
): Promise<{ snapshotHash: string }> {
	const validated = validatedGraphStateSnapshot(snapshot);
	const snapshotHash = await graphStateHash(validated);
	if (await storagePathExists(targetPath)) {
		throw new Error(`Turso import target already exists: ${targetPath}`);
	}
	await Deno.mkdir(storageParentPath(targetPath), { recursive: true });
	const temporaryPath = `${targetPath}.migrating-${crypto.randomUUID()}`;
	const store = new SqliteGraphStore(temporaryPath);
	try {
		await store.initialize();
		await store.restoreGraphState(validated);
		const roundTrip = await store.exportGraphState();
		const roundTripHash = await graphStateHash(roundTrip);
		if (roundTripHash !== snapshotHash) {
			throw new Error(
				`Turso migration verification failed: ${snapshotHash} != ${roundTripHash}`,
			);
		}
		await store.close();
		await Deno.rename(temporaryPath, targetPath);
		return { snapshotHash };
	} catch (cause) {
		try {
			await store.close();
		} catch (closeCause) {
			throw new Error(
				`Turso migration cleanup failed after ${
					cause instanceof Error ? cause.message : String(cause)
				}`,
				{ cause: closeCause },
			);
		}
		throw cause;
	} finally {
		await removeStoragePathIfExists(temporaryPath, false);
	}
}

export async function graphStateHash(snapshot: GraphStateSnapshot): Promise<string> {
	const validated = validatedGraphStateSnapshot(snapshot);
	const canonical = JSON.stringify(canonicalValue(validated));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
	return toHex(digest);
}

async function createColdBackup(
	sourcePath: string,
	backupRoot: string,
	version: number,
	fingerprint: string,
): Promise<string> {
	await Deno.mkdir(backupRoot, { recursive: true });
	const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
	const base = `${backupRoot}/surreal-v${version}-${timestamp}-${
		fingerprint.slice(0, BACKUP_FINGERPRINT_LENGTH)
	}`;
	let backupPath = base;
	for (let attempt = 0; await storagePathExists(backupPath); attempt++) {
		backupPath = `${base}-${attempt + 1}`;
	}
	await copyStoragePath(sourcePath, backupPath);
	return backupPath;
}

async function fingerprintStoragePath(path: string): Promise<string> {
	const entries: string[] = [];
	await collectFingerprintEntries(path, path, entries);
	entries.sort();
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(entries.join("\n")),
	);
	return toHex(digest);
}

async function collectFingerprintEntries(
	root: string,
	path: string,
	entries: string[],
): Promise<void> {
	const stat = await Deno.lstat(path);
	if (stat.isSymlink) throw new Error(`Migration refuses symbolic link: ${path}`);
	if (stat.isFile) {
		const bytes = await Deno.readFile(path);
		const digest = await crypto.subtle.digest("SHA-256", bytes);
		const relative = path.slice(root.length).replaceAll("\\", "/");
		entries.push(`${relative}\0${toHex(digest)}`);
		return;
	}
	if (!stat.isDirectory) throw new Error(`Unsupported migration entry: ${path}`);
	for await (const entry of Deno.readDir(path)) {
		await collectFingerprintEntries(root, `${path}/${entry.name}`, entries);
	}
}

function toHex(digest: ArrayBuffer): string {
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(HEX_RADIX).padStart(HEX_WIDTH, "0"))
		.join("");
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonicalValue(entry)]),
	);
}

async function readMigrationMarker(path: string): Promise<TursoMigrationMarker | null> {
	let text: string;
	try {
		text = await Deno.readTextFile(path);
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return null;
		throw cause;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw new Error(`Invalid Turso migration marker: ${path}`, { cause });
	}
	if (!isMigrationMarker(value)) throw new Error(`Invalid Turso migration marker: ${path}`);
	return value;
}

function isMigrationMarker(value: unknown): value is TursoMigrationMarker {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.markerVersion === TURSO_MIGRATION_MARKER_VERSION &&
		typeof record.sourcePath === "string" &&
		Number.isSafeInteger(record.sourceStorageVersion) &&
		typeof record.sourceFingerprint === "string" &&
		typeof record.snapshotHash === "string" &&
		typeof record.backupPath === "string" &&
		typeof record.migratedAt === "string";
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
	await Deno.mkdir(storageParentPath(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`;
	try {
		await Deno.writeTextFile(temporaryPath, JSON.stringify(value, null, "\t"));
		await Deno.rename(temporaryPath, path);
	} finally {
		await removeStoragePathIfExists(temporaryPath, false);
	}
}
