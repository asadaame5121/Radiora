import { assertEquals } from "jsr:@std/assert@1";
import type { RelationTypeDefinition } from "../src/domain/models.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_state_validation.ts";
import {
	buildItoMakotoFamilyTreeBackup,
	buildSazaeSanFamilyTreeBackup,
} from "./generate_family_tree_backup.ts";

const BACKUP_SCHEMA_VERSION = 7;
const MIN_CUSTOM_DEFS_SAZAE = 5;
const MIN_CUSTOM_DEFS_MAKOTO = 3;

Deno.test("サザエさんの家系図バックアップJSONがRadioraのバリデーションを完全に通過すること", () => {
	const backup = buildSazaeSanFamilyTreeBackup();
	assertEquals(backup.format, "radiora-backup");
	assertEquals(backup.schemaVersion, BACKUP_SCHEMA_VERSION);

	// カスタム関係型定義が登録されていること
	const customDefs = backup.data.relationTypeDefinitions?.filter((d: RelationTypeDefinition) =>
		!d.builtIn
	);
	assertEquals((customDefs?.length ?? 0) >= MIN_CUSTOM_DEFS_SAZAE, true);
	const customNames = new Set(customDefs?.map((d: RelationTypeDefinition) => d.name));
	assertEquals(customNames.has("SPOUSE"), true);
	assertEquals(customNames.has("FATHER_OF"), true);
	assertEquals(customNames.has("MOTHER_OF"), true);
	assertEquals(customNames.has("SIBLING"), true);
	assertEquals(customNames.has("COUSIN"), true);

	// 全てのリンクがカスタム関係型を使用していること
	for (const link of backup.data.links) {
		assertEquals(customNames.has(link.type), true, `Link ${link.id} must use custom type`);
	}

	// Radioraの厳格な不変条件バリデータを通過すること
	const validated = validatedGraphStateSnapshot(backup.data);
	assertEquals(validated.works.length > 0, true);
	assertEquals(validated.links.length > 0, true);
});

Deno.test("伊藤誠の家系図バックアップJSONがRadioraのバリデーションを完全に通過すること", () => {
	const backup = buildItoMakotoFamilyTreeBackup();
	assertEquals(backup.format, "radiora-backup");
	assertEquals(backup.schemaVersion, BACKUP_SCHEMA_VERSION);

	const customDefs = backup.data.relationTypeDefinitions?.filter((d: RelationTypeDefinition) =>
		!d.builtIn
	);
	assertEquals((customDefs?.length ?? 0) >= MIN_CUSTOM_DEFS_MAKOTO, true);

	// Radioraの厳格な不変条件バリデータを通過すること
	const validated = validatedGraphStateSnapshot(backup.data);
	assertEquals(validated.works.length > 0, true);
	assertEquals(validated.links.length > 0, true);
});
