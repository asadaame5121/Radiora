import type { LinkType, RelationTypeDefinition, RelationTypeDirection } from "../domain/models.ts";
import {
	BUILT_IN_RELATION_TYPES,
	validateRelationTypeDefinition,
	validateRelationTypeDefinitions,
} from "../domain/relation_type.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

export type RelationTypeControllerPorts = Pick<
	RadioraBindings,
	"listRelationTypeDefinitions" | "createRelationTypeDefinition"
>;

export class RelationTypeController {
	private ports: RelationTypeControllerPorts;
	private _definitions = $state<readonly RelationTypeDefinition[]>(
		BUILT_IN_RELATION_TYPES.map((def) => ({ ...def })),
	);

	constructor(ports: RelationTypeControllerPorts) {
		this.ports = ports;
	}

	updatePorts(ports: RelationTypeControllerPorts): void {
		this.ports = ports;
	}

	get definitions(): readonly RelationTypeDefinition[] {
		return this._definitions;
	}

	get names(): readonly LinkType[] {
		return this._definitions.map((d: RelationTypeDefinition) => d.name);
	}

	isSymmetric(type: LinkType): boolean {
		const def = this._definitions.find((d: RelationTypeDefinition) => d.name === type);
		return def?.direction === "symmetric";
	}

	async load(): Promise<void> {
		const result = await this.ports.listRelationTypeDefinitions();
		this._definitions = validateRelationTypeDefinitions(result);
	}

	async create(input: {
		name: string;
		direction: RelationTypeDirection;
	}): Promise<RelationTypeDefinition> {
		const result = await this.ports.createRelationTypeDefinition(input);
		const created = validateRelationTypeDefinition(result);
		if (!this._definitions.some((d: RelationTypeDefinition) => d.name === created.name)) {
			this._definitions = [...this._definitions, created];
		}
		return created;
	}

	reconcileFilter<T extends { linkTypes: readonly string[] }>(filter: T): T {
		const missingTypes = this.names.filter((name) => !filter.linkTypes.includes(name));
		if (missingTypes.length === 0) return filter;
		return {
			...filter,
			linkTypes: [...filter.linkTypes, ...missingTypes],
		};
	}
}
