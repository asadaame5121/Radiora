import type { RadioraBindings } from "../shared/bindings.ts";
import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
import { localDateValue } from "./calendar_display.ts";
import { downloadTextFile } from "./download_text_file.ts";
import { FileOperationState } from "./file_operation_state.svelte.ts";
import type { RelationTypeController } from "./relation_type_controller.svelte.ts";
import type { TreeController } from "./tree_controller.svelte.ts";

interface JsonBackupPorts {
	api: Pick<RadioraBindings, "exportJsonBackup" | "restoreJsonBackup">;
	vocabulary: UiVocabulary;
	flush(): Promise<void>;
	relations: Pick<RelationTypeController, "load" | "names">;
	tree: Pick<TreeController, "reconcileRelations">;
	reload(current: () => boolean): Promise<boolean>;
	errorMessage(cause: unknown): string;
	reportError(message: string): void;
}

export class JsonBackupController {
	private readonly operation = new FileOperationState();
	constructor(private readonly ports: JsonBackupPorts) {}

	export = (): Promise<void> =>
		this.operation.run(this.ports.flush, async (current) => {
			const source = await this.ports.api.exportJsonBackup();
			if (!current()) {
				return;
			}
			downloadTextFile(
				source,
				"application/json;charset=utf-8",
				`radiora-backup-${localDateValue(new Date())}.json`,
			);
			return `${this.ports.vocabulary.jsonBackupExportSuccess}。`;
		}, (cause) =>
			this.ports.reportError(
				`${this.ports.vocabulary.jsonBackupExport}ことができませんでした: ${
					this.ports.errorMessage(cause)
				}`,
			));

	restore = (file: Pick<File, "text">): Promise<void> =>
		this.operation.runFile(
			this.ports.flush,
			file,
			async (source, current) => {
				const result = await this.ports.api.restoreJsonBackup(source);
				if (!current()) return;
				await this.ports.relations.load(current);
				if (!current()) return;
				this.ports.tree.reconcileRelations(this.ports.relations.names, true);
				if (!await this.ports.reload(current) || !current()) return;
				return `${this.ports.vocabulary.jsonBackupRestoreSuccess}: ${result.workCount}件の${this.ports.vocabulary.work}。`;
			},
			(cause) =>
				this.ports.reportError(
					`${this.ports.vocabulary.jsonBackupRestore}に失敗しました: ${
						this.ports.errorMessage(cause)
					} ${this.ports.vocabulary.jsonBackupRestoreFailureRecovery}`,
				),
		);

	get notice() {
		return this.operation.notice;
	}
	dispose(): void {
		this.operation.dispose();
	}
}
