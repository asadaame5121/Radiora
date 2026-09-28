import type { ScopedTagSet, TagAlias } from "../domain/models.ts";

export interface TagApi {
	listScopedTags(): Promise<ScopedTagSet[]>;
	listTagAliases(): Promise<TagAlias[]>;
	renameTag(from: string, to: string): Promise<void>;
	mergeTags(sources: string[], target: string): Promise<void>;
}

export interface TagControllerOptions {
	api: TagApi;
	errorMessage: (cause: unknown) => string;
}

export function splitTagInput(value: string): string[] {
	return value.split(/[,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
}

export class TagController {
	scopes = $state<ScopedTagSet[]>([]);
	aliases = $state<TagAlias[]>([]);
	selectedTag = $state<string | null>(null);
	renameFrom = $state("");
	renameTo = $state("");
	mergeSources = $state("");
	mergeTarget = $state("");
	error = $state("");

	constructor(private readonly options: TagControllerOptions) {}

	load = async (): Promise<void> => {
		this.error = "";
		try {
			const [scopes, aliases] = await Promise.all([
				this.options.api.listScopedTags(),
				this.options.api.listTagAliases(),
			]);
			this.scopes = scopes;
			this.aliases = aliases;
			const currentSelected = this.selectedTag;
			if (
				currentSelected &&
				!scopes.some((scope) => scope.tags.includes(currentSelected))
			) {
				this.selectedTag = null;
			}
		} catch (cause) {
			this.error = this.options.errorMessage(cause);
		}
	};

	rename = async (): Promise<void> => {
		this.error = "";
		try {
			await this.options.api.renameTag(this.renameFrom, this.renameTo);
			this.renameFrom = "";
			this.renameTo = "";
			await this.load();
		} catch (cause) {
			this.error = this.options.errorMessage(cause);
		}
	};

	merge = async (): Promise<void> => {
		this.error = "";
		try {
			await this.options.api.mergeTags(
				splitTagInput(this.mergeSources),
				this.mergeTarget,
			);
			this.mergeSources = "";
			this.mergeTarget = "";
			await this.load();
		} catch (cause) {
			this.error = this.options.errorMessage(cause);
		}
	};
}
