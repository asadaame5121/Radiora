<script lang="ts">
	import type { Revision } from "../domain/models";
	import type { ComparisonDocument } from "../services/comparison_service";
	import { chooseInitialRevisionComparison } from "../services/revision_diff";
	import type { ComparisonPair } from "./comparison_controller.svelte.ts";
	import ComparisonPane from "./ComparisonPane.svelte";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		revisions,
		preferredRevisionId,
		selectedPair,
		onPairChange,
	}: {
		revisions: Revision[];
		preferredRevisionId?: string;
		selectedPair?: ComparisonPair;
		onPairChange?: (leftKey: string, rightKey: string) => void;
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
	preferredLeftKey={selectedPair?.leftKey ?? (initial ? `revision:${initial.leftRevisionId}` : undefined)}
	preferredRightKey={selectedPair?.rightKey ?? (initial ? `revision:${initial.rightRevisionId}` : undefined)}
	{onPairChange}
/>
