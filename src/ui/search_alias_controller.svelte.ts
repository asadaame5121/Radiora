import type { SearchAlias } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

type SearchAliasApi = Pick<
	RadioraBindings,
	"listSearchAliases" | "saveSearchAlias" | "deleteSearchAlias"
>;

export class SearchAliasController {
	aliases = $state<SearchAlias[]>([]);
	canonical = $state("");
	variants = $state("");
	error = $state("");

	constructor(
		private readonly api: SearchAliasApi,
		private readonly errorMessage: (cause: unknown) => string,
	) {}

	async load(): Promise<void> {
		this.aliases = await this.api.listSearchAliases();
	}

	save = async (): Promise<void> => {
		this.error = "";
		try {
			await this.api.saveSearchAlias({
				canonical: this.canonical,
				variants: this.variants
					.split(/[,、\n]/)
					.map((value) => value.trim())
					.filter(Boolean),
			});
			this.canonical = "";
			this.variants = "";
			await this.load();
		} catch (cause) {
			this.error = this.errorMessage(cause);
		}
	};

	remove = async (id: string): Promise<void> => {
		await this.api.deleteSearchAlias(id);
		await this.load();
	};

	setCanonical = (value: string): void => {
		this.canonical = value;
	};

	setVariants = (value: string): void => {
		this.variants = value;
	};
}
