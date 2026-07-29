<script lang="ts">
	import type { Revision } from "../domain/models";
	import type { ComparisonDocument } from "../services/comparison_service";
	import { chooseInitialRevisionComparison } from "../services/revision_diff";
	import ComparisonPane from "./ComparisonPane.svelte";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		revisions,
		preferredRevisionId,
	}: {
		revisions: Revision[];
		preferredRevisionId?: string;
	} = $props();
	const vocabulary = useUiVocabulary();

	const documents = $derived<ComparisonDocument[]>(revisions.map((revision) => ({
		scope: "revision",
		workId: revision.workId,
		revisionId: revision.id,
		title: revision.message ?? `${vocabulary.revision} ${revision.id.slice(0, 8)}`,
		text: revision.text,
		createdAt: revision.createdAt,
	})));
	const initial = $derived(chooseInitialRevisionComparison(revisions, preferredRevisionId));
</script>

<ComparisonPane
	{documents}
	context={{ kind: "revision" }}
	preferredLeftKey={initial ? `revision:${initial.leftRevisionId}` : undefined}
	preferredRightKey={initial ? `revision:${initial.rightRevisionId}` : undefined}
/>
