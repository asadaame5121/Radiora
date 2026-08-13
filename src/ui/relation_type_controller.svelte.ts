import {
	DEFAULT_RELATION_TYPE_DEFINITIONS,
	type RelationTypeDefinition,
	type RelationTypeDirection,
} from "../domain/models.ts";
import type { GlobalLineageFilter } from "../services/global_lineage_filter.ts";
import type { RadioraBindings } from "../shared/bindings.ts";
import { isSymmetricRelationType, relationTypeNames } from "./relation_type_catalog.ts";

type RelationTypeApi = Pick<
	RadioraBindings,
	"listRelationTypeDefinitions" | "createRelationTypeDefinition"
>;

export function createRelationTypeController(
	api: RelationTypeApi,
	getFilter: () => GlobalLineageFilter,
	setFilter: (filter: GlobalLineageFilter) => void,
) {
	let definitions = $state<RelationTypeDefinition[]>([...DEFAULT_RELATION_TYPE_DEFINITIONS]);

	function includeNewTypes(next: readonly RelationTypeDefinition[]): void {
		const filter = getFilter();
		const selected = new Set(filter.linkTypes);
		const additions = next.map((definition) => definition.name)
			.filter((name) => !selected.has(name));
		if (additions.length > 0) {
			setFilter({ ...filter, linkTypes: [...filter.linkTypes, ...additions] });
		}
	}

	async function load(): Promise<void> {
		const next = await api.listRelationTypeDefinitions();
		definitions = next;
		includeNewTypes(next);
	}

	async function create(input: {
		name: string;
		direction: RelationTypeDirection;
	}): Promise<void> {
		const created = await api.createRelationTypeDefinition(input);
		definitions = [...definitions, created];
		includeNewTypes([created]);
	}

	return {
		get definitions() {
			return definitions;
		},
		names: () => relationTypeNames(definitions),
		isSymmetric: (type: string) => isSymmetricRelationType(type, definitions),
		load,
		create,
	};
}
