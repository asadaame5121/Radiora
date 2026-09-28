import type { RuleQueryResult, SavedRuleQuery, TransientProjectionNode } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

type RuleQueryApi = Pick<
	RadioraBindings,
	| "runRuleQuery"
	| "listSavedRuleQueries"
	| "saveRuleQuery"
	| "deleteRuleQuery"
	| "buildQueryProjectionNodes"
>;

const QUERY_LIMIT = 500;

export class RuleQueryController {
	source = $state('?- link("LIKE", From, To).');
	name = $state("");
	result = $state<RuleQueryResult | null>(null);
	error = $state("");
	savedQueries = $state<SavedRuleQuery[]>([]);
	nodes = $state<TransientProjectionNode[]>([]);
	projectionName = $state("");
	showProjection = $state(false);

	constructor(
		private readonly api: RuleQueryApi,
		private readonly errorMessage: (cause: unknown) => string,
	) {}

	async loadSavedQueries(): Promise<void> {
		this.savedQueries = await this.api.listSavedRuleQueries();
	}

	async execute(): Promise<void> {
		this.error = "";
		this.result = null;
		this.nodes = [];
		try {
			this.result = await this.api.runRuleQuery(this.source, QUERY_LIMIT);
		} catch (cause) {
			this.error = this.errorMessage(cause);
		}
	}

	loadProjection = async (query: SavedRuleQuery): Promise<void> => {
		this.error = "";
		this.nodes = [];
		this.projectionName = query.name;
		this.source = query.source;
		this.name = query.name;
		this.showProjection = true;
		try {
			const projection = await this.api.buildQueryProjectionNodes(query.id, QUERY_LIMIT);
			this.nodes = projection.nodes;
			this.result = projection.result;
		} catch (cause) {
			this.error = this.errorMessage(cause);
		}
	};

	async save(): Promise<void> {
		this.error = "";
		try {
			await this.api.saveRuleQuery({ name: this.name, source: this.source });
			await this.loadSavedQueries();
			this.name = "";
		} catch (cause) {
			this.error = this.errorMessage(cause);
		}
	}

	remove = async (id: string): Promise<void> => {
		await this.api.deleteRuleQuery(id);
		await this.loadSavedQueries();
	};

	setSource = (value: string): void => {
		this.source = value;
	};
	setName = (value: string): void => {
		this.name = value;
	};
	setError = (value: string): void => {
		this.error = value;
	};
	toggleProjection = (): void => {
		this.showProjection = !this.showProjection;
	};
}
