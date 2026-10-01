import { BUILT_IN_RELATION_TYPES } from "../../src/domain/relation_type.ts";
import type { GraphStateSnapshot } from "../../src/storage/graph_store.ts";

/** Derive historical envelopes from the checked-in rich-text V4 fixture. */
export async function jsonGraphCodecFixture(version: number) {
	if (version === 0) {
		return JSON.parse(
			await Deno.readTextFile(
				new URL("../fixtures/backup-v0.json", import.meta.url),
			),
		);
	}
	const fixture = JSON.parse(
		await Deno.readTextFile(
			new URL("../fixtures/backup-v4.json", import.meta.url),
		),
	);
	fixture.schemaVersion = version;
	fixture.source.storageSchemaVersion = version;
	if (version === 1) {
		delete fixture.data.revisions;
		delete fixture.data.recoverySnapshots;
		fixture.data.branches[0].headRevisionId = null;
	}
	if (version < 3) {
		delete fixture.data.bookmarks;
		delete fixture.data.resumePosition;
	}
	if (version >= 6) fixture.data.emergenceSuggestions = [];
	if (version >= 7) fixture.data.relationTypeDefinitions = structuredClone(BUILT_IN_RELATION_TYPES);
	return fixture;
}

export async function expectedJsonGraphFixture(version: number): Promise<GraphStateSnapshot> {
	const fixture = await jsonGraphCodecFixture(4);
	return {
		...fixture.data,
		revisions: version === 1 ? [] : fixture.data.revisions,
		branches: fixture.data.branches.map((branch: { headRevisionId: string | null }) => ({
			...branch,
			headRevisionId: version === 1 ? null : branch.headRevisionId,
		})),
		emergenceSuggestions: [],
		relationTypeDefinitions: structuredClone(BUILT_IN_RELATION_TYPES),
	};
}
