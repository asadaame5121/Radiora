import { assertEquals, assertNotStrictEquals, assertThrows } from "jsr:@std/assert@1";
import { isSymmetricLinkType, LINK_TYPES } from "../src/domain/models.ts";
import {
	BUILT_IN_RELATION_TYPES,
	createCustomRelationTypeDefinition,
	isBuiltInRelationTypeName,
	isRelationTypeSymmetric,
	normalizeRelationTypeName,
	type RelationTypeDefinition,
	resolveRelationTypeDirection,
	validateCustomRelationTypeName,
	validateRelationTypeDefinition,
	validateRelationTypeDefinitions,
} from "../src/domain/relation_type.ts";

Deno.test("built-in relation definitions derive completely from LINK_TYPES and isSymmetricLinkType", () => {
	assertEquals(BUILT_IN_RELATION_TYPES.length, LINK_TYPES.length);

	for (let i = 0; i < LINK_TYPES.length; i++) {
		const linkType = LINK_TYPES[i];
		const def = BUILT_IN_RELATION_TYPES[i];

		assertEquals(def.name, linkType);
		assertEquals(def.builtIn, true);
		assertEquals(
			def.direction,
			isSymmetricLinkType(linkType) ? "symmetric" : "directed",
		);
		assertEquals(def.createdAt, "1970-01-01T00:00:00.000Z");
	}
});

Deno.test("isBuiltInRelationTypeName identifies built-in link types regardless of case when normalized", () => {
	for (const name of LINK_TYPES) {
		assertEquals(isBuiltInRelationTypeName(name), true);
	}
	assertEquals(isBuiltInRelationTypeName("CUSTOM"), false);
	assertEquals(isBuiltInRelationTypeName("UNKNOWN"), false);
});

Deno.test("normalizeRelationTypeName trims, uppercases, and accepts valid ASCII identifiers", () => {
	assertEquals(normalizeRelationTypeName("  custom_type  "), "CUSTOM_TYPE");
	assertEquals(normalizeRelationTypeName("a"), "A");
	assertEquals(normalizeRelationTypeName("A_1"), "A_1");
	assertEquals(
		normalizeRelationTypeName("A" + "B".repeat(63)),
		"A" + "B".repeat(63),
	);
});

Deno.test("normalizeRelationTypeName throws on invalid names", () => {
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
		assertThrows(
			() => normalizeRelationTypeName(invalid),
			Error,
			undefined,
			`Expected normalizeRelationTypeName("${invalid}") to throw`,
		);
	}
});

Deno.test("validateCustomRelationTypeName rejects built-in names and collisions", () => {
	for (const builtIn of LINK_TYPES) {
		assertThrows(
			() => validateCustomRelationTypeName(builtIn),
			Error,
			"built-in",
		);
		assertThrows(
			() => validateCustomRelationTypeName(builtIn.toLowerCase()),
			Error,
			"built-in",
		);
	}

	const existing = ["CUSTOM_ONE", "CUSTOM_TWO"];
	assertThrows(
		() => validateCustomRelationTypeName("custom_one", existing),
		Error,
		"already exists",
	);
	assertEquals(
		validateCustomRelationTypeName("custom_three", existing),
		"CUSTOM_THREE",
	);
});

Deno.test("validateRelationTypeDefinitions accepts valid built-in and custom types, returning fresh objects", () => {
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

	assertEquals(validated.length, validList.length);
	assertEquals(validated[8], customDirected);
	assertEquals(validated[9], customSymmetric);
	assertNotStrictEquals(validated[8], customDirected);
	assertNotStrictEquals(validated[0], BUILT_IN_RELATION_TYPES[0]);
});

Deno.test("validateRelationTypeDefinitions rejects malformed, invalid, or tampered definitions", () => {
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
				def.name === "RELATED" ? { ...def, direction: "directed" } : def
			),
		},
		{
			label: "tampered built-in createdAt",
			input: BUILT_IN_RELATION_TYPES.map((def) =>
				def.name === "RELATED" ? { ...def, createdAt: "2026-09-01T00:00:00.000Z" } : def
			),
		},
		{
			label: "tampered built-in builtIn flag",
			input: BUILT_IN_RELATION_TYPES.map((def) =>
				def.name === "RELATED" ? { ...def, builtIn: false } : def
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
		assertThrows(
			() => validateRelationTypeDefinitions(input),
			Error,
			undefined,
			`Expected validateRelationTypeDefinitions to throw for case: ${label}`,
		);
	}
});

Deno.test("createCustomRelationTypeDefinition creates valid definition and rejects invalid inputs", () => {
	const created = createCustomRelationTypeDefinition(
		{ name: "custom_type", direction: "symmetric" },
		["OTHER"],
		"2026-09-01T12:00:00.000Z",
	);
	assertEquals(created, {
		name: "CUSTOM_TYPE",
		direction: "symmetric",
		builtIn: false,
		createdAt: "2026-09-01T12:00:00.000Z",
	});

	assertThrows(
		() => createCustomRelationTypeDefinition(null),
		Error,
		"Invalid relation type input",
	);
	assertThrows(
		() => createCustomRelationTypeDefinition({ name: 123, direction: "directed" }),
		Error,
		"Invalid relation type input",
	);
	assertThrows(
		() => createCustomRelationTypeDefinition({ name: "FOO", direction: "invalid" }),
		Error,
		"Invalid relation type input",
	);
	assertThrows(
		() => createCustomRelationTypeDefinition({ name: "RELATED", direction: "symmetric" }),
		Error,
		"built-in",
	);
	assertThrows(
		() =>
			createCustomRelationTypeDefinition(
				{ name: "EXISTING", direction: "directed" },
				["EXISTING"],
			),
		Error,
		"already exists",
	);
	assertThrows(
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

Deno.test("resolveRelationTypeDirection and isRelationTypeSymmetric resolve direction correctly", () => {
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

	assertEquals(resolveRelationTypeDirection("RELATED", customDefinitions), "symmetric");
	assertEquals(resolveRelationTypeDirection("FROM", customDefinitions), "directed");
	assertEquals(resolveRelationTypeDirection("MY_DIRECTED", customDefinitions), "directed");
	assertEquals(resolveRelationTypeDirection("MY_SYMMETRIC", customDefinitions), "symmetric");
	assertEquals(resolveRelationTypeDirection("UNKNOWN", customDefinitions), "directed");

	assertEquals(isRelationTypeSymmetric("RELATED", customDefinitions), true);
	assertEquals(isRelationTypeSymmetric("FROM", customDefinitions), false);
	assertEquals(isRelationTypeSymmetric("MY_DIRECTED", customDefinitions), false);
	assertEquals(isRelationTypeSymmetric("MY_SYMMETRIC", customDefinitions), true);

	// Fallback to built-in when definitions not provided
	assertEquals(isRelationTypeSymmetric("RELATED"), true);
	assertEquals(isRelationTypeSymmetric("FROM"), false);
	assertEquals(isRelationTypeSymmetric("UNKNOWN"), false);
});

Deno.test("validateRelationTypeDefinition validates valid definitions and rejects invalid shapes", () => {
	const validBuiltIn = {
		name: "RELATED",
		direction: "symmetric",
		builtIn: true,
		createdAt: "1970-01-01T00:00:00.000Z",
	};
	assertEquals(validateRelationTypeDefinition(validBuiltIn), validBuiltIn);

	const validCustom = {
		name: "CUSTOM_ONE",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T12:00:00.000Z",
	};
	assertEquals(validateRelationTypeDefinition(validCustom), validCustom);

	assertThrows(() => validateRelationTypeDefinition(null), Error, "must be an object");
	assertThrows(() => validateRelationTypeDefinition([]), Error, "must be an object");
	assertThrows(
		() => validateRelationTypeDefinition({ ...validCustom, name: "invalid-name" }),
		Error,
		"valid canonical uppercase name",
	);
	assertThrows(
		() => validateRelationTypeDefinition({ ...validCustom, direction: "invalid" }),
		Error,
		"must have direction",
	);
	assertThrows(
		() => validateRelationTypeDefinition({ ...validCustom, builtIn: "not-bool" }),
		Error,
		"boolean builtIn flag",
	);
	assertThrows(
		() => validateRelationTypeDefinition({ ...validCustom, createdAt: "not-a-date" }),
		Error,
		"canonical ISO instant",
	);
});
