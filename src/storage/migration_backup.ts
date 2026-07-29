export async function prepareStorageMigrationBackup(
	databasePath: string,
	backupRoot: string,
	versionMarkerPath: string,
	targetVersion: number,
): Promise<string | null> {
	const recordedVersion = await readRecordedVersion(versionMarkerPath);
	if (recordedVersion >= targetVersion) return null;
	if (!(await exists(databasePath))) return null;
	const backupPath = `${backupRoot}\\storage-v${recordedVersion}`;
	assertSeparatePaths(databasePath, backupRoot);
	if (await exists(backupPath)) return backupPath;

	await copyPath(databasePath, backupPath);
	return backupPath;
}

export async function recordStorageVersion(path: string, version: number): Promise<void> {
	await Deno.writeTextFile(path, `${version}\n`);
}

export interface StorageMigrationRestore {
	databasePath: string;
	failedDatabasePath: string | null;
}

export async function restoreStorageMigrationBackup(
	databasePath: string,
	backupPath: string,
	versionMarkerPath: string,
): Promise<StorageMigrationRestore> {
	assertSeparatePaths(databasePath, backupPath);
	if (!(await exists(backupPath))) {
		throw new Error(`Storage migration backup not found: ${backupPath}`);
	}
	const sourceVersion = backupSourceVersion(backupPath);

	const restorePath = `${databasePath}.restore-${crypto.randomUUID()}`;
	const failedDatabasePath = await exists(databasePath)
		? `${databasePath}.migration-failed-${crypto.randomUUID()}`
		: null;

	try {
		await copyPath(backupPath, restorePath);
		if (failedDatabasePath) await Deno.rename(databasePath, failedDatabasePath);
		await Deno.rename(restorePath, databasePath);
		if (sourceVersion === 0) {
			await removeIfExists(versionMarkerPath);
		} else {
			await recordStorageVersion(versionMarkerPath, sourceVersion);
		}
		return { databasePath, failedDatabasePath };
	} catch (cause) {
		await removeIfExists(restorePath, true);
		if (
			failedDatabasePath &&
			!(await exists(databasePath)) &&
			await exists(failedDatabasePath)
		) {
			await Deno.rename(failedDatabasePath, databasePath);
		}
		throw cause;
	}
}

function backupSourceVersion(path: string): number {
	const match = /(?:^|[\\/])storage-v(\d+)$/.exec(path);
	const version = Number(match?.[1]);
	if (!Number.isSafeInteger(version) || version < 0) {
		throw new Error(`Invalid storage migration backup path: ${path}`);
	}
	return version;
}

async function readRecordedVersion(path: string): Promise<number> {
	try {
		const version = Number((await Deno.readTextFile(path)).trim());
		return Number.isSafeInteger(version) && version >= 0 ? version : 0;
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return 0;
		throw cause;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await Deno.stat(path);
		return true;
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return false;
		throw cause;
	}
}

async function removeIfExists(path: string, recursive = false): Promise<void> {
	try {
		await Deno.remove(path, { recursive });
	} catch (cause) {
		if (!(cause instanceof Deno.errors.NotFound)) throw cause;
	}
}

async function copyPath(source: string, destination: string): Promise<void> {
	const stat = await Deno.lstat(source);
	if (stat.isSymlink) throw new Error(`Migration backup refuses symbolic link: ${source}`);
	if (stat.isFile) {
		await Deno.mkdir(parentPath(destination), { recursive: true });
		await Deno.copyFile(source, destination);
		return;
	}
	if (!stat.isDirectory) throw new Error(`Unsupported migration backup entry: ${source}`);

	await Deno.mkdir(destination, { recursive: true });
	for await (const entry of Deno.readDir(source)) {
		await copyPath(`${source}\\${entry.name}`, `${destination}\\${entry.name}`);
	}
}

function parentPath(path: string): string {
	const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
	return separator < 0 ? "." : path.slice(0, separator);
}

function assertSeparatePaths(first: string, second: string): void {
	const normalizedFirst = normalizePath(first);
	const normalizedSecond = normalizePath(second);
	if (
		normalizedFirst === normalizedSecond ||
		normalizedFirst.startsWith(`${normalizedSecond}\\`) ||
		normalizedSecond.startsWith(`${normalizedFirst}\\`)
	) {
		throw new Error(`Migration backup paths must not overlap: ${first}, ${second}`);
	}
}

function normalizePath(path: string): string {
	return path.replaceAll("/", "\\").replaceAll(/\\+/g, "\\").replace(/\\$/, "").toLowerCase();
}
