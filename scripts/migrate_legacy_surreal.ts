import { exportLegacySnapshot } from "../src/storage/legacy_surreal_exporter.ts";
import {
	migrateLegacyStorageToTurso,
	type TursoMigrationResult,
} from "../src/storage/turso_migration.ts";

export interface StandaloneMigrationOptions {
	dataDir?: string;
	sourcePath?: string;
	sourceVersionMarkerPath?: string;
	targetPath?: string;
	markerPath?: string;
	backupRoot?: string;
	exportSnapshot?: (copyPath: string) => ReturnType<typeof exportLegacySnapshot>;
}

export function parseCliArgs(args: readonly string[]): { dataDir?: string } {
	let dataDir: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--data-dir") {
			if (i + 1 >= args.length) {
				throw new Error("Missing value for --data-dir option.");
			}
			const val = args[i + 1].trim();
			if (!val) {
				throw new Error("Value for --data-dir cannot be empty.");
			}
			dataDir = val;
			i++;
		} else {
			throw new Error(`Unknown option or positional argument: '${arg}'`);
		}
	}
	return { dataDir };
}

export async function runStandaloneMigration(
	options: StandaloneMigrationOptions = {},
): Promise<TursoMigrationResult | null> {
	const appData = Deno.env.get("LOCALAPPDATA") ?? Deno.env.get("APPDATA") ?? Deno.cwd();
	const dataDir = options.dataDir ?? `${appData}\\RadioraV2`;
	const surrealDir = `${dataDir}\\surreal`;
	const sourcePath = options.sourcePath ?? `${surrealDir}\\main.db`;
	const sourceVersionMarkerPath = options.sourceVersionMarkerPath ??
		`${surrealDir}\\storage-schema-version`;
	const tursoDir = `${dataDir}\\turso`;
	const targetPath = options.targetPath ?? `${tursoDir}\\radiora.db`;
	const markerPath = options.markerPath ?? `${targetPath}.migration.json`;
	const backupRoot = options.backupRoot ?? `${tursoDir}\\migration-backups`;

	console.log("Starting legacy SurrealDB -> SQLite migration...");
	console.log(`  Source: ${sourcePath}`);
	console.log(`  Target: ${targetPath}`);

	const exporter = options.exportSnapshot ??
		((copyPath: string) =>
			exportLegacySnapshot(copyPath, {
				onLog: (event, fields, cause) => {
					if (cause) console.error(`[${event}]`, cause, fields ?? "");
					else console.log(`[${event}]`, fields ?? "");
				},
			}));

	const result = await migrateLegacyStorageToTurso({
		sourcePath,
		sourceVersionMarkerPath,
		backupRoot,
		targetPath,
		markerPath,
		exportSnapshot: exporter,
	});

	if (result) {
		console.log("Migration completed successfully!");
		console.log(`  Backup: ${result.backupPath}`);
		console.log(`  Snapshot hash: ${result.snapshotHash}`);
	} else {
		console.log("Migration skipped (source does not exist or already migrated).");
	}

	return result;
}

if (import.meta.main) {
	const cliArgs = parseCliArgs(Deno.args);
	await runStandaloneMigration({
		dataDir: cliArgs.dataDir,
	});
}
