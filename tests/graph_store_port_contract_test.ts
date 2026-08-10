import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const expectedPorts: Record<string, string[]> = {
	"advanced_link_resolver.ts": ["DiscoveryStorePort", "OutlineStorePort", "WorkStorePort"],
	"branch_service.ts": ["OutlineStorePort", "RelationStorePort", "WorkStorePort"],
	"comparison_service.ts": ["RelationStorePort", "WorkStorePort"],
	"date_projection.ts": ["OutlineStorePort", "WorkStorePort"],
	"discovery_operations.ts": ["DiscoveryStorePort", "OutlineStorePort", "RelationStorePort"],
	"duplicate_candidates.ts": [
		"DiscoveryStorePort",
		"OutlineStorePort",
		"RelationStorePort",
		"WorkStorePort",
	],
	"internal_reference_service.ts": ["OutlineStorePort", "WorkStorePort"],
	"json_backup.ts": ["BackupStorePort"],
	"navigation_service.ts": ["OutlineStorePort", "WorkStorePort"],
	"occurrence_operations.ts": ["OutlineStorePort", "RelationStorePort", "WorkStorePort"],
	"opml_service.ts": ["OutlineStorePort", "WorkStorePort"],
	"outline_service.ts": [
		"BackupStorePort",
		"DiscoveryStorePort",
		"OutlineStorePort",
		"RelationStorePort",
		"WorkStorePort",
	],
	"quick_capture_service.ts": ["OutlineStorePort", "WorkStorePort"],
	"recovery_snapshot_service.ts": ["WorkStorePort"],
	"revision_service.ts": ["WorkStorePort"],
	"semantic_link_operations.ts": ["OutlineStorePort", "RelationStorePort", "WorkStorePort"],
	"stub_service.ts": ["OutlineStorePort", "WorkStorePort"],
	"tag_service.ts": ["DiscoveryStorePort", "OutlineStorePort", "WorkStorePort"],
	"work_merge_service.ts": [
		"DiscoveryStorePort",
		"OutlineStorePort",
		"RelationStorePort",
		"WorkStorePort",
	],
};

for (const [fileName, ports] of Object.entries(expectedPorts)) {
	const source = await Deno.readTextFile(
		new URL(`../src/services/${fileName}`, import.meta.url),
	);
	Deno.test(`${fileName} depends on feature-specific store ports`, () => {
		assertStringIncludes(source, "../storage/graph_store.ts");
		assert(!/\bGraphStore\b/.test(source));
		assert(!/ReturnType<GraphStore\[/.test(source));
		for (const port of ports) assertStringIncludes(source, port);
	});
}
