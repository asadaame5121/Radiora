export const CURRENT_STORAGE_SCHEMA_VERSION = 3;

export interface SchemaMetadata {
	id: "radiora";
	version: number;
	updatedAt: string;
	lastMigrationId: string;
	appVersion: string;
}

export interface MigrationJournalEntry {
	id: string;
	fromVersion: number;
	toVersion: number;
	startedAt: string;
	completedAt?: string;
	appVersion: string;
	status: "started" | "completed" | "failed";
	error?: string;
}

export interface MigrationContext {
	execute(statement: string, variables?: Record<string, unknown>): Promise<unknown>;
}

export interface StorageMigration {
	id: string;
	fromVersion: number;
	toVersion: number;
	up(context: MigrationContext): Promise<void>;
	validate(context: MigrationContext): Promise<void>;
}

export interface MigrationStateStore {
	readMetadata(): Promise<SchemaMetadata | null>;
	writeMetadata(metadata: SchemaMetadata): Promise<void>;
	writeJournal(entry: MigrationJournalEntry): Promise<void>;
}

interface RunStorageMigrationsOptions {
	state: MigrationStateStore;
	context: MigrationContext;
	migrations: readonly StorageMigration[];
	appVersion: string;
	targetVersion?: number;
	now?: () => string;
}

export async function runStorageMigrations(
	options: RunStorageMigrationsOptions,
): Promise<number> {
	const targetVersion = options.targetVersion ?? CURRENT_STORAGE_SCHEMA_VERSION;
	const now = options.now ?? (() => new Date().toISOString());
	const metadata = await options.state.readMetadata();
	let version = metadata?.version ?? 0;

	if (!Number.isSafeInteger(version) || version < 0) {
		throw new Error(`Invalid storage schema version: ${version}`);
	}
	if (version > targetVersion) {
		throw new Error(
			`Storage schema version ${version} is newer than supported version ${targetVersion}`,
		);
	}

	const byFromVersion = validateMigrationChain(options.migrations, targetVersion);
	while (version < targetVersion) {
		const migration = byFromVersion.get(version);
		if (!migration) {
			throw new Error(`Missing storage migration ${version} -> ${version + 1}`);
		}

		const startedAt = now();
		const journal: MigrationJournalEntry = {
			id: migration.id,
			fromVersion: migration.fromVersion,
			toVersion: migration.toVersion,
			startedAt,
			appVersion: options.appVersion,
			status: "started",
		};
		await options.state.writeJournal(journal);

		try {
			await migration.up(options.context);
			await migration.validate(options.context);
			const completedAt = now();
			await options.state.writeMetadata({
				id: "radiora",
				version: migration.toVersion,
				updatedAt: completedAt,
				lastMigrationId: migration.id,
				appVersion: options.appVersion,
			});
			await options.state.writeJournal({
				...journal,
				completedAt,
				status: "completed",
			});
			version = migration.toVersion;
		} catch (cause) {
			await options.state.writeJournal({
				...journal,
				completedAt: now(),
				status: "failed",
				error: cause instanceof Error ? cause.message : String(cause),
			});
			throw cause;
		}
	}

	return version;
}

function validateMigrationChain(
	migrations: readonly StorageMigration[],
	targetVersion: number,
): Map<number, StorageMigration> {
	const byFromVersion = new Map<number, StorageMigration>();
	for (const migration of migrations) {
		if (migration.toVersion !== migration.fromVersion + 1) {
			throw new Error(
				`Storage migration ${migration.id} must advance exactly one version`,
			);
		}
		if (migration.toVersion > targetVersion) continue;
		if (byFromVersion.has(migration.fromVersion)) {
			throw new Error(
				`Duplicate storage migration from version ${migration.fromVersion}`,
			);
		}
		byFromVersion.set(migration.fromVersion, migration);
	}
	return byFromVersion;
}
