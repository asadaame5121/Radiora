export const LINK_TYPES = [
	"RELATED",
	"FROM",
	"LIKE",
	"SUPPORT",
	"DEF",
	"VS",
	"FIX",
	"CITE",
] as const;

export type BuiltInRelationTypeName = (typeof LINK_TYPES)[number];

export type RelationTypeName = BuiltInRelationTypeName | (string & {});

export type RelationTypeDirection = "directed" | "symmetric";

export const SYMMETRIC_LINK_TYPES = [
	"RELATED",
	"LIKE",
	"VS",
] as const satisfies readonly BuiltInRelationTypeName[];

export function isSymmetricLinkType(type: RelationTypeName): boolean {
	return SYMMETRIC_LINK_TYPES.some((sym) => sym === type);
}

export interface RelationTypeDefinition {
	name: RelationTypeName;
	direction: RelationTypeDirection;
	builtIn: boolean;
	createdAt: string;
}

export const RELATION_TYPE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

const BUILT_IN_CREATED_AT = "1970-01-01T00:00:00.000Z";

export const BUILT_IN_RELATION_TYPES: readonly RelationTypeDefinition[] = LINK_TYPES.map((
	name,
) => ({
	name,
	direction: isSymmetricLinkType(name) ? "symmetric" : "directed",
	builtIn: true,
	createdAt: BUILT_IN_CREATED_AT,
})) satisfies readonly RelationTypeDefinition[];

export function isBuiltInRelationTypeName(name: string): boolean {
	const normalized = name.trim().toUpperCase();
	return LINK_TYPES.some((builtIn) => builtIn === normalized);
}

export function normalizeRelationTypeName(value: string): RelationTypeName {
	const normalized = value.trim().toUpperCase();
	if (!RELATION_TYPE_NAME_PATTERN.test(normalized)) {
		throw new Error(
			"Relation type name must start with A-Z and contain only A-Z, 0-9, or _ (maximum 64 characters)",
		);
	}
	return normalized;
}

export function validateCustomRelationTypeName(
	value: string,
	existingNames?: Iterable<string>,
): RelationTypeName {
	const normalized = normalizeRelationTypeName(value);
	if (isBuiltInRelationTypeName(normalized)) {
		throw new Error(
			`Relation type name "${normalized}" conflicts with a built-in relation type`,
		);
	}
	if (existingNames) {
		for (const existing of existingNames) {
			if (existing.trim().toUpperCase() === normalized) {
				throw new Error(
					`Relation type name "${normalized}" already exists`,
				);
			}
		}
	}
	return normalized;
}

function isValidIsoDate(value: string): boolean {
	const parsed = Date.parse(value);
	return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function assertBuiltInRelationDefinition(
	name: string,
	direction: RelationTypeDirection,
	builtIn: boolean,
	createdAt: string,
): void {
	if (!builtIn) {
		throw new Error(
			`Built-in relation type "${name}" must have builtIn set to true`,
		);
	}
	const expectedDirection = isSymmetricLinkType(name) ? "symmetric" : "directed";
	if (direction !== expectedDirection) {
		throw new Error(
			`Built-in relation type "${name}" must have direction "${expectedDirection}"`,
		);
	}
	if (createdAt !== BUILT_IN_CREATED_AT) {
		throw new Error(
			`Built-in relation type "${name}" must have createdAt "${BUILT_IN_CREATED_AT}"`,
		);
	}
}

export function validateRelationTypeDefinition(item: unknown): RelationTypeDefinition {
	if (typeof item !== "object" || item === null || Array.isArray(item)) {
		throw new Error("Relation type definition must be an object");
	}

	if (
		!("name" in item) || typeof item.name !== "string" ||
		!RELATION_TYPE_NAME_PATTERN.test(item.name)
	) {
		throw new Error(
			"Relation type definition must have a valid canonical uppercase name",
		);
	}
	const name = item.name;

	if (
		!("direction" in item) ||
		(item.direction !== "directed" && item.direction !== "symmetric")
	) {
		throw new Error(
			`Relation type "${name}" must have direction "directed" or "symmetric"`,
		);
	}
	const direction: RelationTypeDirection = item.direction;

	if (!("builtIn" in item) || typeof item.builtIn !== "boolean") {
		throw new Error(
			`Relation type "${name}" must have a boolean builtIn flag`,
		);
	}
	const builtIn = item.builtIn;

	if (
		!("createdAt" in item) || typeof item.createdAt !== "string" ||
		!isValidIsoDate(item.createdAt)
	) {
		throw new Error(
			`Relation type "${name}" must have a canonical ISO instant createdAt timestamp`,
		);
	}
	const createdAt = item.createdAt;

	if (isBuiltInRelationTypeName(name)) {
		assertBuiltInRelationDefinition(name, direction, builtIn, createdAt);
	} else if (builtIn) {
		throw new Error(
			`Custom relation type "${name}" must have builtIn set to false`,
		);
	}

	return {
		name,
		direction,
		builtIn,
		createdAt,
	};
}

export function validateRelationTypeDefinitions(input: unknown): RelationTypeDefinition[] {
	if (!Array.isArray(input)) {
		throw new Error("Relation type definitions must be an array");
	}

	const result: RelationTypeDefinition[] = [];
	const seenNames = new Set<string>();

	for (const item of input) {
		const def = validateRelationTypeDefinition(item);
		if (seenNames.has(def.name)) {
			throw new Error(`Duplicate relation type definition found for "${def.name}"`);
		}
		seenNames.add(def.name);
		result.push(def);
	}

	for (const builtInName of LINK_TYPES) {
		if (!seenNames.has(builtInName)) {
			throw new Error(`Missing built-in relation type "${builtInName}"`);
		}
	}

	return result;
}

export interface CreateCustomRelationTypeInput {
	name: string;
	direction: RelationTypeDirection;
}

export function createCustomRelationTypeDefinition(
	input: unknown,
	existingNames?: Iterable<string>,
	createdAt = new Date().toISOString(),
): RelationTypeDefinition {
	if (
		typeof input !== "object" ||
		input === null ||
		Array.isArray(input) ||
		typeof (input as { name?: unknown }).name !== "string" ||
		((input as { direction?: unknown }).direction !== "directed" &&
			(input as { direction?: unknown }).direction !== "symmetric")
	) {
		throw new Error(
			"Invalid relation type input: expected object with name string and direction",
		);
	}
	if (!isValidIsoDate(createdAt)) {
		throw new Error(
			"Relation type createdAt must be a canonical ISO instant timestamp",
		);
	}
	const typed = input as CreateCustomRelationTypeInput;
	const canonicalName = validateCustomRelationTypeName(typed.name, existingNames);
	return {
		name: canonicalName,
		direction: typed.direction,
		builtIn: false,
		createdAt,
	};
}

export function resolveRelationTypeDirection(
	type: string,
	definitions?: readonly RelationTypeDefinition[],
): RelationTypeDirection {
	const def = definitions?.find((d) => d.name === type);
	if (def) return def.direction;
	return isSymmetricLinkType(type) ? "symmetric" : "directed";
}

export function isRelationTypeSymmetric(
	type: string,
	definitions?: readonly RelationTypeDefinition[],
): boolean {
	return resolveRelationTypeDirection(type, definitions) === "symmetric";
}
