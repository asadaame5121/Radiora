import type { LinkType, RelationTypeDefinition } from "../domain/models.ts";

export function relationTypeNames(
	definitions: readonly RelationTypeDefinition[],
): LinkType[] {
	return definitions.map((definition) => definition.name);
}

export function isSymmetricRelationType(
	type: LinkType,
	definitions: readonly RelationTypeDefinition[],
): boolean {
	return definitions.find((definition) => definition.name === type)?.direction === "symmetric";
}

export function cycleRelationType(
	types: readonly LinkType[],
	current: LinkType | undefined,
	offset: 1 | -1,
): LinkType | undefined {
	if (types.length === 0) return current;
	const index = current === undefined ? 0 : types.indexOf(current);
	return types[(index + offset + types.length) % types.length];
}
