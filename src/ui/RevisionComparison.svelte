<script lang="ts">
	import type { Revision } from "../domain/models";
	import {
		chooseInitialRevisionComparison,
		diffRevisionText,
		type RevisionDiffNode,
	} from "../services/revision_diff";

	let {
		revisions,
		preferredRevisionId,
	}: {
		revisions: Revision[];
		preferredRevisionId?: string;
	} = $props();

	let leftRevisionId = $state("");
	let rightRevisionId = $state("");
	const leftRevision = $derived(
		revisions.find((revision) => revision.id === leftRevisionId) ?? null,
	);
	const rightRevision = $derived(
		revisions.find((revision) => revision.id === rightRevisionId) ?? null,
	);
	const diffNodes = $derived(
		leftRevision && rightRevision
			? diffRevisionText(leftRevision.text, rightRevision.text)
			: [],
	);
	const leftNodes = $derived(
		diffNodes.filter((node) => node.kind !== "add"),
	);
	const rightNodes = $derived(
		diffNodes.filter((node) => node.kind !== "remove"),
	);

	$effect(() => {
		if (
			revisions.some((revision) => revision.id === leftRevisionId) &&
			revisions.some((revision) => revision.id === rightRevisionId)
		) return;
		const initial = chooseInitialRevisionComparison(revisions, preferredRevisionId);
		leftRevisionId = initial?.leftRevisionId ?? "";
		rightRevisionId = initial?.rightRevisionId ?? "";
	});

	function labelFor(revision: Revision): string {
		const date = new Date(revision.createdAt);
		const created = Number.isNaN(date.getTime())
			? "日時不明"
			: date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
		return `${created}${revision.message ? ` · ${revision.message}` : ""}`;
	}

	function changeLabel(node: RevisionDiffNode): string {
		if (node.kind === "add") return "追加";
		if (node.kind === "remove") return "削除";
		return "変更なし";
	}
</script>

<section class="revision-comparison" aria-label="版比較">
	<div class="comparison-heading">
		<div>
			<p class="eyebrow">VERSION COMPARISON</p>
			<h1>本文を版ごとに比較</h1>
		</div>
		<p>左右は別々にスクロールできます。保存済みの本文は変更されません。</p>
	</div>

	{#if revisions.length < 2}
		<p class="comparison-empty">比較できる版が2件以上ありません。</p>
	{:else}
		<div class="comparison-grid">
			<section class="comparison-side">
				<label for="left-version">左の版</label>
				<select id="left-version" bind:value={leftRevisionId}>
					{#each revisions as revision (revision.id)}
						<option value={revision.id}>{labelFor(revision)}</option>
					{/each}
				</select>
				<div
					class="comparison-scroll"
					data-comparison-pane="left"
					role="region"
					aria-label="左の版の本文"
				>
					{#each leftNodes as node}
						<div class:equal={node.kind === "equal"} class:remove={node.kind === "remove"}
							class="diff-line" aria-label={changeLabel(node)}>
							<span>{node.leftLineNumber ?? ""}</span>
							<code>{node.text || "\u00a0"}</code>
						</div>
					{/each}
				</div>
			</section>

			<section class="comparison-side">
				<label for="right-version">右の版</label>
				<select id="right-version" bind:value={rightRevisionId}>
					{#each revisions as revision (revision.id)}
						<option value={revision.id}>{labelFor(revision)}</option>
					{/each}
				</select>
				<div
					class="comparison-scroll"
					data-comparison-pane="right"
					role="region"
					aria-label="右の版の本文"
				>
					{#each rightNodes as node}
						<div class:equal={node.kind === "equal"} class:add={node.kind === "add"}
							class="diff-line" aria-label={changeLabel(node)}>
							<span>{node.rightLineNumber ?? ""}</span>
							<code>{node.text || "\u00a0"}</code>
						</div>
					{/each}
				</div>
			</section>
		</div>
	{/if}
</section>
