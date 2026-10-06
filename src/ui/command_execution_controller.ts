import type { CreateLinkInput } from "../domain/models.ts";
import { type CommandContext, type CommandId, dispatchCommand } from "./command_service.ts";
export interface CommandPayload {
	snapshotId?: string;
	linkInput?: CreateLinkInput;
	exportOccurrenceId?: string;
}
export interface CommandExecutionPorts {
	context(): CommandContext;
	operations: Partial<Record<CommandId, (payload: CommandPayload) => unknown>>;
	reportError(cause: unknown): void;
	reportUnavailable(reason: string): void;
}
/** All command entry points share availability and a single in-flight operation. */
export class CommandExecutionController {
	private executing = false;
	private disposed = false;
	constructor(private readonly ports: CommandExecutionPorts) {}
	execute = async (id: CommandId, payload: CommandPayload = {}): Promise<void> => {
		await this.run(async () => {
			const context = payload.snapshotId
				? { ...this.ports.context(), hasSelectedRecoverySnapshot: true }
				: this.ports.context();
			const result = await dispatchCommand(id, context, async (command) => {
				await this.ports.operations[command]?.(payload);
			});
			if (!this.disposed && !result.executed && result.reason) {
				this.ports.reportUnavailable(result.reason);
			}
		});
	};
	run = async (action: () => Promise<unknown>): Promise<void> => {
		if (this.disposed || this.executing) return;
		this.executing = true;
		try {
			await action();
		} catch (cause) {
			if (!this.disposed) this.ports.reportError(cause);
		} finally {
			this.executing = false;
		}
	};
	dispose(): void {
		this.disposed = true;
	}
}
