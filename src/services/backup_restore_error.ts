export type BackupRestoreErrorCode =
	| "invalid-json"
	| "invalid-backup"
	| "unsupported-version"
	| "restore-failed";

/** Local service error. RPC keeps its existing message-only error contract. */
export class BackupRestoreError extends Error {
	override readonly name = "BackupRestoreError";

	constructor(
		readonly code: BackupRestoreErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}
