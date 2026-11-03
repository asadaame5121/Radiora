import { expect, test } from "vitest";
import { expectThrown } from "../support/expect_errors.ts";
import { isSymmetricLinkType, LINK_TYPES } from "../../../src/domain/models.ts";
import {
	BUILT_IN_RELATION_TYPES,
	createCustomRelationTypeDefinition,
	isBuiltInRelationTypeName,
	isRelationTypeAdvancesGeneration,
	isRelationTypeSymmetric,
	normalizeRelationTypeName,
	type RelationTypeDefinition,
	resolveRelationTypeDirection,
	validateCustomRelationTypeName,
	validateRelationTypeDefinition,
	validateRelationTypeDefinitions,
} from "../../../src/domain/relation_type.ts";

test("built-in relation definitions derive completely from LINK_TYPES and isSymmetricLinkType", () => {
	expect(BUILT_IN_RELATION_TYPES.length).toEqual(LINK_TYPES.length);

	for (let i = 0; i < LINK_TYPES.length; i++) {
		const linkType = LINK_TYPES[i];
		const def = BUILT_IN_RELATION_TYPES[i];

		expect(def.name).toEqual(linkType);
		expect(def.builtIn).toEqual(true);
		expect(def.direction).toEqual(isSymmetricLinkType(linkType) ? "symmetric" : "directed");
		expect(def.createdAt).toEqual("1970-01-01T00:00:00.000Z");
	}
});

test("isBuiltInRelationTypeName identifies built-in link types regardless of case when normalized", () => {
	for (const name of LINK_TYPES) {
		expect(isBuiltInRelationTypeName(name)).toEqual(true);
	}
	expect(isBuiltInRelationTypeName("CUSTOM")).toEqual(false);
	expect(isBuiltInRelationTypeName("UNKNOWN")).toEqual(false);
});

test("normalizeRelationTypeName trims, uppercases, and accepts valid ASCII identifiers", () => {
	expect(normalizeRelationTypeName("  custom_type  ")).toEqual("CUSTOM_TYPE");
	expect(normalizeRelationTypeName("a")).toEqual("A");
	expect(normalizeRelationTypeName("A_1")).toEqual("A_1");
	expect(normalizeRelationTypeName("A" + "B".repeat(63))).toEqual("A" + "B".repeat(63));
});

test("normalizeRelationTypeName throws on invalid names", () => {
	const invalidCases = [
		"",
		"   ",
		"1START_WITH_NUMBER",
		"_START_WITH_UNDERSCORE",
		"HAS-DASH",
		"HAS SPACE",
		"HAS.DOT",
		"HAS:COLON",
		"日本語",
		"A" + "B".repeat(64), // 65 chars
	];

	for (const invalid of invalidCases) {
		expectThrown(
			() => normalizeRelationTypeName(invalid),
			Error,
			undefined,
			`Expected normalizeRelationTypeName("${invalid}") to throw`,
		);
	}
});

test("validateCustomRelationTypeName rejects built-in names and collisions", () => {
	for (const builtIn of LINK_TYPES) {
		expectThrown(() => validateCustomRelationTypeName(builtIn), Error, "built-in");
		expectThrown(() => validateCustomRelationTypeName(builtIn.toLowerCase()), Error, "built-in");
	}

	const existing = ["CUSTOM_ONE", "CUSTOM_TWO"];
	expectThrown(
		() => validateCustomRelationTypeName("custom_one", existing),
		Error,
		"already exists",
	);
	expect(validateCustomRelationTypeName("custom_three", existing)).toEqual("CUSTOM_THREE");
});

test("validateRelationTypeDefinitions accepts valid built-in and custom types, returning fresh objects", () => {
	const customDirected: RelationTypeDefinition = {
		name: "CUSTOM_DIRECTED",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	const customSymmetric: RelationTypeDefinition = {
		name: "CUSTOM_SYMMETRIC",
		direction: "symmetric",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};

	const validList = [...BUILT_IN_RELATION_TYPES, customDirected, customSymmetric];
	const validated = validateRelationTypeDefinitions(validList);

	expect(validated.length).toEqual(validList.length);
	expect(validated[8]).toEqual(customDirected);
	expect(validated[9]).toEqual(customSymmetric);
	expect(validated[8]).not.toBe(customDirected);
	expect(validated[0]).not.toBe(BUILT_IN_RELATION_TYPES[0]);
});

test("validateRelationTypeDefinitions rejects malformed, invalid, or tampered definitions", () => {
	const customValid = {
		name: "CUSTOM",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};

	const invalidCases: Array<{ label: string; input: unknown }> = [
		{ label: "non-array null", input: null },
		{ label: "non-array string", input: "not-an-array" },
		{ label: "non-array object", input: { name: "RELATED" } },
		{ label: "malformed element null", input: [...BUILT_IN_RELATION_TYPES, null] },
		{ label: "malformed element array", input: [...BUILT_IN_RELATION_TYPES, []] },
		{
			label: "missing fields",
			input: [...BUILT_IN_RELATION_TYPES, { name: "CUSTOM" }],
		},
		{
			label: "invalid direction",
			input: [...BUILT_IN_RELATION_TYPES, { ...customValid, direction: "invalid" }],
		},
		{
			label: "invalid date format",
			input: [...BUILT_IN_RELATION_TYPES, { ...customValid, createdAt: "invalid-date" }],
		},
		{
			label: "non-canonical date",
			input: [...BUILT_IN_RELATION_TYPES, { ...customValid, createdAt: "2026-09-01" }],
		},
		{
			label: "lowercase stored name",
			input: [...BUILT_IN_RELATION_TYPES, { ...customValid, name: "custom_lower" }],
		},
		{
			label: "missing built-in",
			input: BUILT_IN_RELATION_TYPES.filter((def) => def.name !== "FROM"),
		},
		{
			label: "tampered built-in direction",
			input: BUILT_IN_RELATION_TYPES.map((def) =>
				def.name === "RELATED" ? { ...def, direction: "directed" } : def,
			),
		},
		{
			label: "tampered built-in createdAt",
			input: BUILT_IN_RELATION_TYPES.map((def) =>
				def.name === "RELATED" ? { ...def, createdAt: "2026-09-01T00:00:00.000Z" } : def,
			),
		},
		{
			label: "tampered built-in builtIn flag",
			input: BUILT_IN_RELATION_TYPES.map((def) =>
				def.name === "RELATED" ? { ...def, builtIn: false } : def,
			),
		},
		{
			label: "custom with builtIn true",
			input: [...BUILT_IN_RELATION_TYPES, { ...customValid, builtIn: true }],
		},
		{
			label: "duplicate relation names",
			input: [...BUILT_IN_RELATION_TYPES, customValid, { ...customValid }],
		},
	];

	for (const { label, input } of invalidCases) {
		expectThrown(
			() => validateRelationTypeDefinitions(input),
			Error,
			undefined,
			`Expected validateRelationTypeDefinitions to throw for case: ${label}`,
		);
	}
});

test("createCustomRelationTypeDefinition creates valid definition and rejects invalid inputs", () => {
	const created = createCustomRelationTypeDefinition(
		{ name: "custom_type", direction: "symmetric" },
		["OTHER"],
		"2026-09-01T12:00:00.000Z",
	);
	expect(created).toEqual({
		name: "CUSTOM_TYPE",
		direction: "symmetric",
		builtIn: false,
		createdAt: "2026-09-01T12:00:00.000Z",
	});

	expectThrown(
		() => createCustomRelationTypeDefinition(null),
		Error,
		"Invalid relation type input",
	);
	expectThrown(
		() => createCustomRelationTypeDefinition({ name: 123, direction: "directed" }),
		Error,
		"Invalid relation type input",
	);
	expectThrown(
		() => createCustomRelationTypeDefinition({ name: "FOO", direction: "invalid" }),
		Error,
		"Invalid relation type input",
	);
	expectThrown(
		() => createCustomRelationTypeDefinition({ name: "RELATED", direction: "symmetric" }),
		Error,
		"built-in",
	);
	expectThrown(
		() =>
			createCustomRelationTypeDefinition({ name: "EXISTING", direction: "directed" }, ["EXISTING"]),
		Error,
		"already exists",
	);
	expectThrown(
		() =>
			createCustomRelationTypeDefinition(
				{ name: "VALID_NAME", direction: "directed" },
				undefined,
				"not-a-timestamp",
			),
		Error,
		"canonical ISO instant",
	);
});

test("resolveRelationTypeDirection and isRelationTypeSymmetric resolve direction correctly", () => {
	const customDefinitions: RelationTypeDefinition[] = [
		...BUILT_IN_RELATION_TYPES,
		{
			name: "MY_DIRECTED",
			direction: "directed",
			builtIn: false,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
		{
			name: "MY_SYMMETRIC",
			direction: "symmetric",
			builtIn: false,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
	];

	expect(resolveRelationTypeDirection("RELATED", customDefinitions)).toEqual("symmetric");
	expect(resolveRelationTypeDirection("FROM", customDefinitions)).toEqual("directed");
	expect(resolveRelationTypeDirection("MY_DIRECTED", customDefinitions)).toEqual("directed");
	expect(resolveRelationTypeDirection("MY_SYMMETRIC", customDefinitions)).toEqual("symmetric");
	expect(resolveRelationTypeDirection("UNKNOWN", customDefinitions)).toEqual("directed");

	expect(isRelationTypeSymmetric("RELATED", customDefinitions)).toEqual(true);
	expect(isRelationTypeSymmetric("FROM", customDefinitions)).toEqual(false);
	expect(isRelationTypeSymmetric("MY_DIRECTED", customDefinitions)).toEqual(false);
	expect(isRelationTypeSymmetric("MY_SYMMETRIC", customDefinitions)).toEqual(true);

	// Fallback to built-in when definitions not provided
	expect(isRelationTypeSymmetric("RELATED")).toEqual(true);
	expect(isRelationTypeSymmetric("FROM")).toEqual(false);
	expect(isRelationTypeSymmetric("UNKNOWN")).toEqual(false);
});

test("validateRelationTypeDefinition validates valid definitions and rejects invalid shapes", () => {
	const validBuiltIn = {
		name: "RELATED",
		direction: "symmetric",
		builtIn: true,
		createdAt: "1970-01-01T00:00:00.000Z",
	};
	expect(validateRelationTypeDefinition(validBuiltIn)).toEqual(validBuiltIn);

	const validCustom = {
		name: "CUSTOM_ONE",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T12:00:00.000Z",
	};
	expect(validateRelationTypeDefinition(validCustom)).toEqual(validCustom);

	expectThrown(() => validateRelationTypeDefinition(null), Error, "must be an object");
	expectThrown(() => validateRelationTypeDefinition([]), Error, "must be an object");
	expectThrown(
		() => validateRelationTypeDefinition({ ...validCustom, name: "invalid-name" }),
		Error,
		"valid canonical uppercase name",
	);
	expectThrown(
		() => validateRelationTypeDefinition({ ...validCustom, direction: "invalid" }),
		Error,
		"must have direction",
	);
	expectThrown(
		() => validateRelationTypeDefinition({ ...validCustom, builtIn: "not-bool" }),
		Error,
		"boolean builtIn flag",
	);
	expectThrown(
		() => validateRelationTypeDefinition({ ...validCustom, createdAt: "not-a-date" }),
		Error,
		"canonical ISO instant",
	);
});

test("built-in relation definitions set advancesGeneration to true only for FROM", () => {
	for (const def of BUILT_IN_RELATION_TYPES) {
		if (def.name === "FROM") {
			expect(def.advancesGeneration).toEqual(true);
		} else {
			expect(def.advancesGeneration).toEqual(false);
		}
	}
});

test("createCustomRelationTypeDefinition supports optional advancesGeneration", () => {
	const defaultDef = createCustomRelationTypeDefinition({
		name: "PARENT_OF",
		direction: "directed",
	});
	expect(defaultDef.advancesGeneration).toEqual(undefined);
	expect(isRelationTypeAdvancesGeneration("PARENT_OF", [defaultDef])).toEqual(false);

	const advancingDef = createCustomRelationTypeDefinition({
		name: "FATHER_OF",
		direction: "directed",
		advancesGeneration: true,
	});
	expect(advancingDef.advancesGeneration).toEqual(true);
	expect(isRelationTypeAdvancesGeneration("FATHER_OF", [advancingDef])).toEqual(true);
});

test("validateRelationTypeDefinition validates advancesGeneration invariants", () => {
	// FROM must have advancesGeneration true
	expectThrown(
		() =>
			validateRelationTypeDefinition({
				name: "FROM",
				direction: "directed",
				builtIn: true,
				createdAt: "1970-01-01T00:00:00.000Z",
				advancesGeneration: false,
			}),
		Error,
		'Built-in relation type "FROM" must have advancesGeneration set to true',
	);

	// Other built-in must have advancesGeneration false
	expectThrown(
		() =>
			validateRelationTypeDefinition({
				name: "SUPPORT",
				direction: "directed",
				builtIn: true,
				createdAt: "1970-01-01T00:00:00.000Z",
				advancesGeneration: true,
			}),
		Error,
		'Built-in relation type "SUPPORT" must have advancesGeneration set to false',
	);

	// Custom type can have advancesGeneration true or false
	const customAdvancing = validateRelationTypeDefinition({
		name: "PARENT_OF",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
		advancesGeneration: true,
	});
	expect(customAdvancing.advancesGeneration).toEqual(true);
	expect(isRelationTypeAdvancesGeneration("PARENT_OF", [customAdvancing])).toEqual(true);

	// Backward compatibility: optional advancesGeneration
	const customWithout = validateRelationTypeDefinition({
		name: "PARENT_OF_OLD",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	});
	expect(customWithout.advancesGeneration).toEqual(undefined);
	expect(isRelationTypeAdvancesGeneration("PARENT_OF_OLD", [customWithout])).toEqual(false);
});
