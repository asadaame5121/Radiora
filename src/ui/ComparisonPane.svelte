<script lang="ts">
	import type {
		ComparableLinkType,
		ComparisonDocument,
	} from "../services/comparison_service";
	import { comparisonDocumentKey } from "../services/comparison_service";
	import { diffText, type RevisionDiffNode } from "../services/revision_diff";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	export type ComparisonContext =
		| { kind: "revision" | "branch" }
		| {
			kind: "semantic-link";
			type: ComparableLinkType;
			direction: "directed" | "symmetric";
			createdAt: string;
			reason?: string;
		};

	let {
		documents,
		context,
		preferredLeftKey,
		preferredRightKey,
		locked = false,
	}: {
		documents: ComparisonDocument[];
		context: ComparisonContext;
		preferredLeftKey?: string;
		preferredRightKey?: string;
		locked?: boolean;
	} = $props();

	const vocabulary = useUiVocabulary();
	let leftKey = $state("");
	let rightKey = $state("");
	let appliedPreferenceSignature = $state("");
	const left = $derived(
		documents.find((document) => comparisonDocumentKey(document) === leftKey) ?? null,
	);
	const right = $derived(
		documents.find((document) => comparisonDocumentKey(document) === rightKey) ?? null,
	);
	const showDiff = $derived(left?.scope === "revision" && right?.scope === "revision");
	const nodes = $derived(left && right && showDiff ? diffText(left.text, right.text) : []);
	const leftNodes = $derived(nodes.filter((node) => node.kind !== "add"));
	const rightNodes = $derived(nodes.filter((node) => node.kind !== "remove"));

	$effect(() => {
		const keys = documents.map(comparisonDocumentKey);
		const preferenceSignature =
			`${keys.join("\u0000")}\u0001${preferredLeftKey ?? ""}\u0001${preferredRightKey ?? ""}`;
		if (preferenceSignature !== appliedPreferenceSignature) {
			appliedPreferenceSignature = preferenceSignature;
			const preferredLeft = preferredLeftKey && keys.includes(preferredLeftKey)
				? preferredLeftKey
				: undefined;
			const preferredRight = preferredRightKey && keys.includes(preferredRightKey)
				? preferredRightKey
				: undefined;
			leftKey = preferredLeft ?? keys.find((key) => key !== preferredRight) ?? "";
			rightKey = preferredRight ?? [...keys].reverse().find((key) => key !== leftKey) ?? "";
			return;
		}
		if (keys.includes(leftKey) && keys.includes(rightKey) && leftKey !== rightKey) return;
		leftKey = keys[0] ?? "";
		rightKey = keys.find((key) => key !== leftKey) ?? "";
	});

	function sourceLabel(document: ComparisonDocument): string {
		if (document.scope === "revision") return vocabulary.fixedRevision;
		if (document.scope === "branch") return vocabulary.branch;
		return vocabulary.workingCopy;
	}

	function displayTitle(document: ComparisonDocument): string {
		if (document.title) return document.title;
		return document.scope === "revision"
			? `(${vocabulary.fixedRevision})`
			: `(${vocabulary.workingCopy})`;
	}

	function selectLeft(next: string): void {
		if (next === rightKey) rightKey = leftKey;
		leftKey = next;
	}

	function selectRight(next: string): void {
		if (next === leftKey) leftKey = rightKey;
		rightKey = next;
	}

	function relationLabel(): string {
		if (context.kind !== "semantic-link") {
			return context.kind === "revision"
				? `${vocabulary.revision}間${vocabulary.comparisonPane}`
				: `${vocabulary.branch}・${vocabulary.revision}${vocabulary.comparisonPane}`;
		}
		if (context.type === "FROM") return `${vocabulary.comparisonLeft} → FROM → ${vocabulary.comparisonRight}`;
		if (context.type === "FIX") return `${vocabulary.comparisonLeft} → FIX → ${vocabulary.comparisonRight}`;
		return `${vocabulary.comparisonLeft} ↔ VS ↔ ${vocabulary.comparisonRight}`;
	}

	function documentTime(document: ComparisonDocument): string {
		return formatTime(document.createdAt ?? document.updatedAt);
	}

	function formatTime(value?: string): string {
		if (!value) return "";
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? vocabulary.unknownTime
			: date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
	}

	function changeLabel(node: RevisionDiffNode): string {
		if (node.kind === "add") return vocabulary.comparisonAdded;
		if (node.kind === "remove") return vocabulary.comparisonRemoved;
		return vocabulary.comparisonUnchanged;
	}
</script>

<section class="revision-comparison comparison-pane" aria-label={vocabulary.comparisonPane}>
	<div class="comparison-heading">
		<div>
			<p class="eyebrow">COMPARISON</p>
			<h1>{vocabulary.comparisonPane}</h1>
		</div>
		<div class="comparison-context">
			<strong>{relationLabel()}</strong>
			{#if context.kind === "semantic-link"}
				<time datetime={context.createdAt}>{formatTime(context.createdAt)}</time>
				{#if context.reason}
					<span>{vocabulary.comparisonReason}: {context.reason}</span>
				{/if}
			{/if}
		</div>
	</div>

	{#if documents.length < 2 || !left || !right}
		<p class="comparison-empty">{vocabulary.comparisonPane}できる本文が2件以上ありません。</p>
	{:else}
		<div class="comparison-grid">
			<section class="comparison-side">
				<label for="comparison-left">{vocabulary.comparisonLeft}</label>
				{#if locked}
					<div class="comparison-source-label">{sourceLabel(left)} · {displayTitle(left)}</div>
				{:else}
					<select id="comparison-left" value={leftKey}
						onchange={(event) => selectLeft(event.currentTarget.value)}>
						{#each documents as document}
							<option value={comparisonDocumentKey(document)}>
								{sourceLabel(document)} · {displayTitle(document)}
							</option>
						{/each}
					</select>
				{/if}
				<small>{sourceLabel(left)}{documentTime(left) ? ` · ${documentTime(left)}` : ""}</small>
				<div class="comparison-scroll" data-comparison-pane="left" role="region"
					aria-label={`${vocabulary.comparisonLeft}の本文`}>
					{#if showDiff}
						{#each leftNodes as node}
							<div class:equal={node.kind === "equal"} class:remove={node.kind === "remove"}
								class="diff-line" aria-label={changeLabel(node)}>
								<span>{node.leftLineNumber ?? ""}</span>
								<code>{node.text || "\u00a0"}</code>
							</div>
						{/each}
					{:else}
						<pre>{left.text}</pre>
					{/if}
				</div>
			</section>

			<section class="comparison-side">
				<label for="comparison-right">{vocabulary.comparisonRight}</label>
				{#if locked}
					<div class="comparison-source-label">{sourceLabel(right)} · {displayTitle(right)}</div>
				{:else}
					<select id="comparison-right" value={rightKey}
						onchange={(event) => selectRight(event.currentTarget.value)}>
						{#each documents as document}
							<option value={comparisonDocumentKey(document)}>
								{sourceLabel(document)} · {displayTitle(document)}
							</option>
						{/each}
					</select>
				{/if}
				<small>{sourceLabel(right)}{documentTime(right) ? ` · ${documentTime(right)}` : ""}</small>
				<div class="comparison-scroll" data-comparison-pane="right" role="region"
					aria-label={`${vocabulary.comparisonRight}の本文`}>
					{#if showDiff}
						{#each rightNodes as node}
							<div class:equal={node.kind === "equal"} class:add={node.kind === "add"}
								class="diff-line" aria-label={changeLabel(node)}>
								<span>{node.rightLineNumber ?? ""}</span>
								<code>{node.text || "\u00a0"}</code>
							</div>
						{/each}
					{:else}
						<pre>{right.text}</pre>
					{/if}
				</div>
			</section>
		</div>
	{/if}
</section>

<style>
	.revision-comparison {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 18px;
		height: 100%;
		min-width: 0;
		padding: 24px 28px;
		overflow: hidden;
	}
	.comparison-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 24px;
	}
	.comparison-heading h1 {
		margin: 4px 0 0;
		font-family: var(--font-serif);
		font-size: 21px;
		font-weight: normal;
		color: #edf9fa;
	}
	.comparison-context {
		display: flex;
		flex-direction: column;
		align-items: end;
		gap: 3px;
		color: var(--muted);
		font-size: 10px;
	}
	.comparison-context strong {
		color: var(--cyan);
		font-weight: normal;
	}
	.comparison-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 12px;
		min-height: 0;
	}
	.comparison-side {
		display: grid;
		grid-template-rows: auto auto auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		overflow: hidden;
	}
	.comparison-side label {
		padding: 10px 12px 4px;
		color: var(--cyan);
		font-size: 10px;
		letter-spacing: .1em;
	}
	.comparison-side select {
		margin: 0 10px 10px;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 7px;
		background: var(--surface-raised);
		color: var(--text);
	}
	.comparison-source-label {
		margin: 0 10px 10px;
		padding: 7px;
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		background: var(--surface-raised);
		font-size: 11px;
	}
	.comparison-side > small {
		padding: 0 12px 8px;
		color: var(--muted);
		font-size: 9px;
	}
	.comparison-scroll {
		min-height: 0;
		overflow: auto;
		border-top: 1px solid var(--border);
		background: var(--bg);
	}
	.comparison-scroll pre {
		margin: 0;
		padding: 12px;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.65;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.diff-line {
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr);
		min-height: 25px;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		line-height: 1.65;
	}
	.diff-line > span {
		padding: 3px 8px;
		border-right: 1px solid var(--border);
		color: var(--muted);
		text-align: right;
		font: 10px/1.65 var(--font-mono);
		user-select: none;
	}
	.diff-line code {
		display: block;
		padding: 3px 9px;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 11px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.diff-line.add {
		background: rgb(44 129 86 / 18%);
		box-shadow: inset 3px 0 #45b87c;
	}
	.diff-line.remove {
		background: rgb(156 62 73 / 18%);
		box-shadow: inset 3px 0 #c65d69;
	}
	.diff-line.equal {
		background: transparent;
	}
	.comparison-empty {
		align-self: center;
		justify-self: center;
		color: var(--muted);
		font-size: 12px;
	}
</style>
