import { invoke } from "@tauri-apps/api/core";
import * as v from "valibot";
import {
	BlockIdSchema,
	CommandErrorSchema,
	type CreateDocumentRequest,
	type Saved,
	SavedSchema,
	type UpdateBodyRequest,
	type WorkspaceView,
	WorkspaceViewSchema,
} from "./workspace_dto.ts";
import { WorkspaceCommandError, type WorkspacePort } from "./workspace_port.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * The only module that talks to Tauri IPC. Validates every response and turns rejections
 * into `WorkspaceCommandError`, so the controller never sees raw IPC values.
 */
export function createTauriWorkspaceAdapter(call: Invoke = invoke): WorkspacePort {
	async function request<T>(
		command: string,
		schema: v.GenericSchema<unknown, T>,
		args?: Record<string, unknown>,
	): Promise<T> {
		let raw: unknown;
		try {
			raw = await call(command, args);
		} catch (error) {
			throw toCommandError(command, error);
		}
		const parsed = v.safeParse(schema, raw);
		if (!parsed.success) {
			throw new WorkspaceCommandError("invalid_response", `${command} returned an invalid value`, {
				cause: new v.ValiError(parsed.issues),
			});
		}
		return parsed.output;
	}

	return {
		view: (): Promise<WorkspaceView> => request("workspace_view", WorkspaceViewSchema),
		newBlockId: (): Promise<string> => request("new_block_id", BlockIdSchema),
		createDocument: (body: CreateDocumentRequest): Promise<Saved> =>
			request("create_document", SavedSchema, { request: body }),
		updateBody: (body: UpdateBodyRequest): Promise<Saved> =>
			request("update_body", SavedSchema, { request: body }),
		retrySave: (): Promise<Saved> => request("retry_save", SavedSchema),
	};
}

function toCommandError(command: string, error: unknown): WorkspaceCommandError {
	const parsed = v.safeParse(CommandErrorSchema, error);
	if (parsed.success) {
		return new WorkspaceCommandError(parsed.output.kind, parsed.output.message, {
			currentVersion: parsed.output.currentVersion,
			cause: error,
		});
	}
	return new WorkspaceCommandError("transport", `${command} could not reach the backend`, {
		cause: error,
	});
}
