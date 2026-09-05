import * as v from "valibot";

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

export const BuiltInRelationTypeNameSchema = v.picklist(LINK_TYPES);

export type BuiltInRelationTypeName = v.InferOutput<
	typeof BuiltInRelationTypeNameSchema
>;

export type RelationTypeName = BuiltInRelationTypeName | (string & {});

export const RelationTypeDirectionSchema = v.picklist(
	["directed", "symmetric"],
	"Relation type must have direction 'directed' or 'symmetric'",
);

export type RelationTypeDirection = v.InferOutput<
	typeof RelationTypeDirectionSchema
>;

export const SYMMETRIC_LINK_TYPES = [
	"RELATED",
	"LIKE",
	"VS",
] as const satisfies readonly BuiltInRelationTypeName[];

export const SymmetricLinkTypesSchema = v.picklist(SYMMETRIC_LINK_TYPES);

export type SymmetricLinkTypes = v.InferOutput<typeof SymmetricLinkTypesSchema>;

export function isSymmetricLinkType(type: RelationTypeName): boolean {
	return SYMMETRIC_LINK_TYPES.some((sym) => sym === type);
}

export type RelationTypeDefinition = v.InferOutput<
	typeof RelationTypeDefinitionSchema
>;

export const RELATION_TYPE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export const RelationTypeNameSchema = v.pipe(
	v.string("Relation type definition must have a valid canonical uppercase name"),
	v.regex(
		RELATION_TYPE_NAME_PATTERN,
		"Relation type definition must have a valid canonical uppercase name",
	),
);

export const RelationTypeNamePatternSchema = RelationTypeNameSchema;

const BUILT_IN_CREATED_AT = "1970-01-01T00:00:00.000Z";

function isValidIsoDate(value: string): boolean {
	const parsed = Date.parse(value);
	return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

export const CreatedAtSchema = v.pipe(
	v.string("Relation type createdAt must be a canonical ISO instant timestamp"),
	v.check(
		isValidIsoDate,
		"Relation type createdAt must be a canonical ISO instant timestamp",
	),
);

export const createdAtSchema = CreatedAtSchema;

export const RelationTypeDefinitionSchema = v.object(
	{
		name: RelationTypeNameSchema,
		direction: RelationTypeDirectionSchema,
		builtIn: v.boolean("Relation type must have a boolean builtIn flag"),
		createdAt: CreatedAtSchema,
		advancesGeneration: v.optional(
			v.boolean("Relation type advancesGeneration must be a boolean"),
		),
	},
	"Relation type definition must be an object",
);

export const BUILT_IN_RELATION_TYPES: readonly RelationTypeDefinition[] = LINK_TYPES.map((
	name,
) => ({
	name,
	direction: isSymmetricLinkType(name) ? "symmetric" : "directed",
	builtIn: true,
	createdAt: BUILT_IN_CREATED_AT,
	advancesGeneration: name === "FROM",
})) satisfies readonly RelationTypeDefinition[];

export function isBuiltInRelationTypeName(name: string): boolean {
	const normalized = name.trim().toUpperCase();
	const result = v.safeParse(BuiltInRelationTypeNameSchema, normalized);
	return result.success;
}

export function normalizeRelationTypeName(value: string): RelationTypeName {
	const normalized = value.trim().toUpperCase();
	const result = v.safeParse(RelationTypeNameSchema, normalized);
	if (!result.success) {
		throw new Error(result.issues[0]?.message);
	}
	return result.output;
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
				throw new Error(`Relation type name "${normalized}" already exists`);
			}
		}
	}
	return normalized;
}

function assertBuiltInRelationDefinition(
	name: string,
	direction: RelationTypeDirection,
	builtIn: boolean,
	createdAt: string,
	advancesGeneration?: boolean,
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
	const expectedAdvancesGeneration = name === "FROM";
	if (
		advancesGeneration !== undefined &&
		advancesGeneration !== expectedAdvancesGeneration
	) {
		throw new Error(
			`Built-in relation type "${name}" must have advancesGeneration set to ${expectedAdvancesGeneration}`,
		);
	}
}

export function validateRelationTypeDefinition(
	item: unknown,
): RelationTypeDefinition {
	const result = v.safeParse(RelationTypeDefinitionSchema, item);
	if (!result.success) {
		throw new Error(result.issues[0].message);
	}
	const def = result.output;

	if (isBuiltInRelationTypeName(def.name)) {
		assertBuiltInRelationDefinition(
			def.name,
			def.direction,
			def.builtIn,
			def.createdAt,
			def.advancesGeneration,
		);
	} else if (def.builtIn) {
		throw new Error(
			`Custom relation type "${def.name}" must have builtIn set to false`,
		);
	}

	return def;
}

export function validateRelationTypeDefinitions(
	input: unknown,
): RelationTypeDefinition[] {
	if (!Array.isArray(input)) {
		throw new Error("Relation type definitions must be an array");
	}

	const result: RelationTypeDefinition[] = [];
	const seenNames = new Set<string>();

	for (const item of input) {
		const def = validateRelationTypeDefinition(item);
		if (seenNames.has(def.name)) {
			throw new Error(
				`Duplicate relation type definition found for "${def.name}"`,
			);
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

export const CreateCustomRelationTypeInputSchema = v.object(
	{
		name: v.string(
			"Invalid relation type input: expected object with name string and direction",
		),
		direction: v.picklist(
			["directed", "symmetric"],
			"Invalid relation type input: expected object with name string and direction",
		),
		advancesGeneration: v.optional(v.boolean()),
	},
	"Invalid relation type input: expected object with name string and direction",
);

export type CreateCustomRelationTypeInput = v.InferOutput<
	typeof CreateCustomRelationTypeInputSchema
>;

export function createCustomRelationTypeDefinition(
	input: unknown,
	existingNames?: Iterable<string>,
	createdAt = new Date().toISOString(),
): RelationTypeDefinition {
	const inputResult = v.safeParse(CreateCustomRelationTypeInputSchema, input);
	if (!inputResult.success) {
		throw new Error(inputResult.issues[0].message);
	}
	const createdAtResult = v.safeParse(CreatedAtSchema, createdAt);
	if (!createdAtResult.success) {
		throw new Error(createdAtResult.issues[0].message);
	}
	const typed = inputResult.output;
	const canonicalName = validateCustomRelationTypeName(
		typed.name,
		existingNames,
	);
	const custom: RelationTypeDefinition = {
		name: canonicalName,
		direction: typed.direction,
		builtIn: false,
		createdAt: createdAtResult.output,
	};
	if (typed.advancesGeneration !== undefined) {
		custom.advancesGeneration = typed.advancesGeneration;
	}
	return custom;
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

export function isRelationTypeAdvancesGeneration(
	type: string,
	definitions?: readonly RelationTypeDefinition[],
): boolean {
	const def = definitions?.find((d) => d.name === type);
	if (def && typeof def.advancesGeneration === "boolean") {
		return def.advancesGeneration;
	}
	return type === "FROM";
}
