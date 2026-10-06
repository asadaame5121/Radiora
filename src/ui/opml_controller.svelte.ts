import type { RadioraBindings } from "../shared/bindings.ts";
import type { UiVocabulary } from "../shared/ui_vocabulary.ts";
import { localDateValue } from "./calendar_display.ts";
import { downloadTextFile } from "./download_text_file.ts";
import { FileOperationState } from "./file_operation_state.svelte.ts";

interface OpmlPorts {
	api: Pick<RadioraBindings, "exportOpml" | "importOpml">;
	vocabulary: UiVocabulary;
	flush(): Promise<void>;
	reload(current: () => boolean): Promise<boolean>;
	errorMessage(cause: unknown): string;
	reportError(message: string): void;
}

export class OpmlController {
	private readonly operation = new FileOperationState();
	constructor(private readonly ports: OpmlPorts) {}

	export = (): Promise<void> =>
		this.operation.run(this.ports.flush, async (current) => {
			const source = await this.ports.api.exportOpml();
			if (!current()) {
				return;
			}
			downloadTextFile(
				source,
				"text/x-opml;charset=utf-8",
				`radiora-${localDateValue(new Date())}.opml`,
			);
			return `${this.ports.vocabulary.opmlExportSuccess}。`;
		}, (cause) =>
			this.ports.reportError(
				`${this.ports.vocabulary.opmlExport}ことができませんでした: ${
					this.ports.errorMessage(cause)
				}`,
			));

	import = (file: Pick<File, "text">): Promise<void> =>
		this.operation.runFile(
			this.ports.flush,
			file,
			async (source, current) => {
				const result = await this.ports.api.importOpml(source);
				if (!current()) return;
				if (!await this.ports.reload(current) || !current()) return;
				return `${this.ports.vocabulary.opmlImportSuccess}: ${result.importedCount}件。`;
			},
			(cause) =>
				this.ports.reportError(
					`${this.ports.vocabulary.opmlImport}ことができませんでした: ${
						this.ports.errorMessage(cause)
					}`,
				),
		);

	get notice() {
		return this.operation.notice;
	}
	dispose(): void {
		this.operation.dispose();
	}
}
