import type {
	CreateDocumentRequest,
	ErrorKind,
	Saved,
	UpdateBodyRequest,
	WorkspaceView,
} from "./workspace_dto.ts";

/** Backend operations the body-slice controller needs; implemented by the Tauri adapter. */
export interface WorkspacePort {
	view(): Promise<WorkspaceView>;
	newBlockId(): Promise<string>;
	createDocument(request: CreateDocumentRequest): Promise<Saved>;
	updateBody(request: UpdateBodyRequest): Promise<Saved>;
	retrySave(): Promise<Saved>;
}

/** A rejected workspace command with a stable kind to branch on. */
export class WorkspaceCommandError extends Error {
	readonly kind: ErrorKind;
	readonly currentVersion: number | null;

	constructor(
		kind: ErrorKind,
		message: string,
		options: { currentVersion?: number | null; cause?: unknown } = {},
	) {
		super(message, { cause: options.cause });
		this.name = "WorkspaceCommandError";
		this.kind = kind;
		this.currentVersion = options.currentVersion ?? null;
	}
}
