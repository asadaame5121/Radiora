export async function prepareStorageMigrationBackup(
	databasePath: string,
	backupPath: string,
	versionMarkerPath: string,
	targetVersion: number,
): Promise<string | null> {
	const recordedVersion = await readRecordedVersion(versionMarkerPath);
	if (recordedVersion >= targetVersion) return null;
	if (!(await exists(databasePath))) return null;
	if (await exists(backupPath)) return backupPath;

	await copyPath(databasePath, backupPath);
	return backupPath;
}

export async function recordStorageVersion(path: string, version: number): Promise<void> {
	await Deno.writeTextFile(path, `${version}\n`);
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
