export const SQLITE_STORAGE_SCHEMA_VERSION = 1;

export const SQLITE_RECORD_TABLES = [
	"work",
	"branch",
	"working_copy",
	"revision",
	"recovery_snapshot",
	"occurrence",
	"semantic_link",
	"system_relation",
	"knot",
	"search_alias",
	"emergence_feedback",
	"emergence_suggestion",
	"saved_rule_query",
	"purge_manifest",
	"bookmark",
	"resume_position",
] as const;

const RECORD_TABLE_DDL = SQLITE_RECORD_TABLES.map((table) => `
	CREATE TABLE IF NOT EXISTS ${table} (
		id TEXT PRIMARY KEY CHECK (length(id) > 0),
		position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
		payload TEXT NOT NULL CHECK (json_valid(payload))
	) STRICT;
	CREATE INDEX IF NOT EXISTS idx_${table}_position ON ${table}(position);`).join("\n");

export const SQLITE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS storage_metadata (
	id TEXT PRIMARY KEY CHECK (id = 'radiora'),
	schema_version INTEGER NOT NULL,
	updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS migration_journal (
	id TEXT PRIMARY KEY,
	from_version INTEGER NOT NULL,
	to_version INTEGER NOT NULL,
	started_at TEXT NOT NULL,
	completed_at TEXT,
	status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
	error TEXT
) STRICT;
${RECORD_TABLE_DDL}
`;
