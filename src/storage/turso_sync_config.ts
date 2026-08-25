export interface TursoSyncConfig {
	syncUrl: string;
	authToken: string;
	syncIntervalMs?: number;
}

export type TursoSyncStatus =
	| "disabled"
	| "synced"
	| "syncing"
	| "offline"
	| "auth_expired"
	| "needs_review";

export class TursoSyncConfigError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "TursoSyncConfigError";
	}
}

export interface SanitizedSyncLogConfig {
	protocol: string;
	host: string;
	hasToken: boolean;
	syncIntervalMs?: number;
}

const ALLOWED_PROTOCOLS = new Set(["https:", "libsql:"]);
const MIN_PRINTABLE_ASCII = 32;
const DEL_ASCII = 127;

function hasControlCharacter(value: string): boolean {
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		if (code < MIN_PRINTABLE_ASCII || code === DEL_ASCII) return true;
	}
	return false;
}

function validateUrlString(rawUrl: unknown): string {
	if (typeof rawUrl !== "string" || !rawUrl.trim()) {
		throw new TursoSyncConfigError("Turso syncUrl must be a non-empty string");
	}
	const syncUrl = rawUrl.trim();
	let parsed: URL;
	try {
		parsed = new URL(syncUrl);
	} catch (cause) {
		throw new TursoSyncConfigError("Turso syncUrl is not a valid URL", { cause });
	}

	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
		throw new TursoSyncConfigError(
			`Unsupported Turso syncUrl protocol: ${parsed.protocol}. Must be https or libsql`,
		);
	}
	if (!parsed.hostname || parsed.username || parsed.password) {
		throw new TursoSyncConfigError("Turso syncUrl must contain a host and no credentials");
	}
	return syncUrl;
}

function validateTokenString(rawToken: unknown): string {
	if (typeof rawToken !== "string" || !rawToken.trim()) {
		throw new TursoSyncConfigError("Turso authToken must be a non-empty string");
	}
	if (hasControlCharacter(rawToken)) {
		throw new TursoSyncConfigError(
			"Turso authToken contains invalid control characters or newlines",
		);
	}
	return rawToken.trim();
}

function validateInterval(rawInterval: unknown): number | undefined {
	if (rawInterval === undefined || rawInterval === null) return undefined;
	if (typeof rawInterval !== "number" || !Number.isFinite(rawInterval) || rawInterval <= 0) {
		throw new TursoSyncConfigError("Turso syncIntervalMs must be a positive number");
	}
	return rawInterval;
}

export function validateTursoSyncConfig(raw: unknown): TursoSyncConfig {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new TursoSyncConfigError("Turso sync config must be an object");
	}
	const candidate = raw as Record<string, unknown>;
	const syncUrl = validateUrlString(candidate.syncUrl);
	const authToken = validateTokenString(candidate.authToken);
	const syncIntervalMs = validateInterval(candidate.syncIntervalMs);

	return {
		syncUrl,
		authToken,
		...(syncIntervalMs !== undefined ? { syncIntervalMs } : {}),
	};
}

export interface EnvReader {
	get(key: string): string | undefined;
}

export function readTursoSyncConfigFromEnv(env: EnvReader = Deno.env): TursoSyncConfig | null {
	const syncUrl = env.get("RADIORA_TURSO_SYNC_URL");
	const authToken = env.get("RADIORA_TURSO_SYNC_TOKEN");
	const interval = env.get("RADIORA_TURSO_SYNC_INTERVAL_MS");

	if (!syncUrl && !authToken) return null;

	if (!syncUrl || !authToken) {
		throw new TursoSyncConfigError(
			"Both RADIORA_TURSO_SYNC_URL and RADIORA_TURSO_SYNC_TOKEN are required when sync is enabled",
		);
	}

	return validateTursoSyncConfig({
		syncUrl,
		authToken,
		...(interval ? { syncIntervalMs: Number(interval) } : {}),
	});
}

export function sanitizeSyncConfigForLog(config: TursoSyncConfig): SanitizedSyncLogConfig {
	const parsed = new URL(config.syncUrl);

	return {
		protocol: parsed.protocol,
		host: parsed.hostname,
		hasToken: Boolean(config.authToken && config.authToken.length > 0),
		...(config.syncIntervalMs !== undefined ? { syncIntervalMs: config.syncIntervalMs } : {}),
	};
}
