import * as v from "valibot";

/**
 * Runtime schemas of the body-slice IPC DTOs (`crates/radiora-desktop/src/dto.rs`).
 * Responses from the backend are validated here; a type annotation alone is not trusted.
 */
const VersionSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const LogicalIdSchema = v.pipe(v.string(), v.uuid());

export const SavedSchema = v.strictObject({
	version: VersionSchema,
	replayed: v.boolean(),
});

export const BlockSchema = v.strictObject({
	id: LogicalIdSchema,
	parentId: v.nullable(LogicalIdSchema),
	index: v.pipe(v.number(), v.integer(), v.minValue(0)),
	body: v.string(),
});

export const WorkspaceViewSchema = v.strictObject({
	version: VersionSchema,
	blocks: v.array(BlockSchema),
});

export const BlockIdSchema = LogicalIdSchema;

export const ERROR_KINDS = [
	"invalid_request",
	"workspace_unavailable",
	"stale_version",
	"request_reused",
	"persist_pending",
	"persist_failed",
	"recovery_required",
	"nothing_to_retry",
	"unknown_block",
	"duplicate_block",
	"no_body",
	"storage",
] as const;

export const CommandErrorSchema = v.strictObject({
	kind: v.picklist(ERROR_KINDS),
	message: v.string(),
	currentVersion: v.nullable(VersionSchema),
});

export type Saved = v.InferOutput<typeof SavedSchema>;
export type BlockDto = v.InferOutput<typeof BlockSchema>;
export type WorkspaceView = v.InferOutput<typeof WorkspaceViewSchema>;
/** Backend kinds plus the two the frontend adapter reports itself. */
export type ErrorKind = (typeof ERROR_KINDS)[number] | "invalid_response" | "transport";

export type CreateDocumentRequest = {
	requestId: string;
	baseVersion: number;
	blockId: string;
};

export type UpdateBodyRequest = CreateDocumentRequest & { body: string };
