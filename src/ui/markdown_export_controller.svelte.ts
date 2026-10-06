import type { OutlineSnapshot } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";
import {
	renderOutlineSnapshotMarkdown,
	rewriteMarkdownExportReferences,
	selectMarkdownExportSnapshot,
} from "../services/markdown_export.ts";
import { localDateValue } from "./calendar_display.ts";
import { downloadTextFile } from "./download_text_file.ts";
import {
	loadMarkdownExportPreference,
	type MarkdownExportPreference,
	saveMarkdownExportPreference,
} from "./markdown_export_preference.ts";

interface MarkdownExportPorts {
	api: Pick<RadioraBindings, "resolveInternalReferences" | "recordClientOperation">;
	flush(): Promise<void>;
	snapshot(): OutlineSnapshot;
	selectedId(): string | null;
	errorMessage(cause: unknown): string;
	reportError(message: string): void;
}

export class MarkdownExportController {
	private _preference = $state(loadMarkdownExportPreference());
	private _notice = $state("");
	private generation = 0;
	private disposed = false;

	constructor(private readonly ports: MarkdownExportPorts) {}
	get preference() {
		return this._preference;
	}
	get notice() {
		return this._notice;
	}

	setPreference = (next: MarkdownExportPreference): void => {
		this._preference = { ...next };
		saveMarkdownExportPreference(this._preference);
	};

	export = async (selectedOccurrenceId?: string): Promise<void> => {
		if (this.disposed) return;
		const generation = ++this.generation;
		const current = () => !this.disposed && generation === this.generation;
		this._notice = "";
		const started = performance.now();
		let outcome: "ok" | "error" = "ok";
		try {
			await this.ports.flush();
			if (!current()) return;
			const preference = this._preference;
			const exportSnapshot = selectMarkdownExportSnapshot(this.ports.snapshot(), {
				...preference,
				scope: selectedOccurrenceId ? "selected" : preference.scope,
				selectedOccurrenceId: selectedOccurrenceId ?? this.ports.selectedId(),
			});
			const rendered = renderOutlineSnapshotMarkdown(exportSnapshot);
			const resolutions = preference.referenceMode === "obsidian"
				? await this.ports.api.resolveInternalReferences(rendered)
				: [];
			const markdown = rewriteMarkdownExportReferences(
				rendered,
				preference.referenceMode,
				resolutions,
			);
			if (!current()) return;
			downloadTextFile(
				markdown,
				"text/markdown;charset=utf-8",
				`radiora-${localDateValue(new Date())}.md`,
			);
			this._notice = "Markdownをエクスポートしました。";
		} catch (cause) {
			outcome = "error";
			if (current()) {
				this.ports.reportError(
					`Markdownをエクスポートできませんでした: ${this.ports.errorMessage(cause)}`,
				);
			}
		} finally {
			void this.ports.api.recordClientOperation(
				"export.markdown",
				outcome,
				performance.now() - started,
			)
				.catch(() => console.warn("Could not record Markdown export."));
		}
	};

	dispose(): void {
		this.disposed = true;
		this.generation++;
	}
}
