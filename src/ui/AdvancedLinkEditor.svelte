<script lang="ts">
	import type { CreateLinkInput } from "../domain/models";
	import type { RadioraBindings } from "../shared/bindings";
	import {
		AdvancedLinkParseError,
		parseAdvancedLinkInput,
	} from "../services/advanced_link_parser";
	import type {
		AdvancedLinkCandidate,
		AdvancedLinkEndpointResolution,
		AdvancedLinkResolution,
		AdvancedLinkSelections,
	} from "../services/advanced_link_resolver";
	import {
		reconcileAdvancedLinkSelections,
		type AdvancedLinkSelectionQueries,
	} from "./advanced_link_selection";
	import { useUiVocabulary } from "./ui_vocabulary_context";
	import { createRpcAdapter } from "./rpc_adapter";

	let {
		selectedWorkId,
		selectedDisplayName,
		onConfirm,
	}: {
		selectedWorkId?: string;
		selectedDisplayName?: string;
		onConfirm: (input: CreateLinkInput) => void | Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
	const api = createRpcAdapter<RadioraBindings>();

	let input = $state("");
	let resolution = $state<AdvancedLinkResolution | null>(null);
	let selections = $state<AdvancedLinkSelections>({});
	let selectionQueries = $state<AdvancedLinkSelectionQueries>({});
	let parseError = $state<AdvancedLinkParseError | null>(null);
	let requestNumber = 0;
	let submitting = $state(false);
	let submitError = $state("");
	let initializedWorkId = "";

	const ready = $derived(
		resolution?.source.status === "resolved" &&
			resolution.type.status === "resolved" &&
			resolution.target.status === "resolved",
	);

	$effect(() => {
		if (!selectedWorkId || selectedWorkId === initializedWorkId) return;
		initializedWorkId = selectedWorkId;
		const source = quoteField(selectedDisplayName?.trim() || selectedWorkId.slice(0, 8));
		input = `${source} :: RELATED :: `;
		selections = { sourceWorkId: selectedWorkId };
		selectionQueries = { source: selectedDisplayName?.trim() || selectedWorkId.slice(0, 8) };
		resolution = null;
		parseError = null;
	});

	async function resolveInput(): Promise<void> {
		const request = ++requestNumber;
		submitError = "";
		try {
			const parsed = parseAdvancedLinkInput(input);
			parseError = null;
			const reconciled = reconcileAdvancedLinkSelections(parsed, selections, selectionQueries);
			selections = reconciled.selections;
			selectionQueries = reconciled.queries;
			const next = await api.resolveAdvancedLink(input, reconciled.selections);
			if (request === requestNumber) resolution = next;
		} catch (cause) {
			if (request !== requestNumber) return;
			resolution = null;
			parseError = cause instanceof AdvancedLinkParseError ? cause : null;
			if (!parseError) submitError = errorMessage(cause);
		}
	}

	function selectCandidate(field: "source" | "target", workId: string): void {
		selections = {
			...selections,
			[field === "source" ? "sourceWorkId" : "targetWorkId"]: workId,
		};
		const endpoint = resolution?.[field];
		selectionQueries = { ...selectionQueries, [field]: endpoint?.query };
		void resolveInput();
	}

	async function createStubFor(field: "source" | "target"): Promise<void> {
		const endpoint = resolution?.[field];
		const query = endpoint?.query.trim();
		if (!endpoint || endpoint.status !== "unresolved" || !query || submitting) return;
		try {
			submitting = true;
			submitError = "";
			const created = await api.createStub("advanced-link-editor", query);
			selectCandidate(field, created.workId);
		} catch (cause) {
			submitError = errorMessage(cause);
		} finally {
			submitting = false;
		}
	}

	async function confirm(): Promise<void> {
		if (!ready || !resolution?.source.selectedWorkId || !resolution.target.selectedWorkId) return;
		try {
			submitting = true;
			submitError = "";
			await onConfirm({
				fromId: resolution.source.selectedWorkId,
				toId: resolution.target.selectedWorkId,
				type: resolution.type.value,
			});
			input = "";
			resolution = null;
			selections = {};
			selectionQueries = {};
			initializedWorkId = "";
		} catch (cause) {
			submitError = errorMessage(cause);
		} finally {
			submitting = false;
		}
	}

	function fieldReason(field: "source" | "type" | "target"): string {
		if (parseError) {
			if (parseError.field === field) return syntaxReason(parseError);
			if (field === "source" && selections.sourceWorkId) return `${vocabulary.work}を選択済みです。`;
			return `${fieldLabel(field)}はまだ解決されていません。`;
		}
		if (field === "type") {
			return resolution?.type
				? `${resolution.type.value} として解決しました。`
				: `${fieldLabel(field)}を入力してください。`;
		}
		const value = resolution?.[field];
		if (!value) {
			if (field === "source" && selections.sourceWorkId) return `${vocabulary.work}を選択済みです。`;
			return `${fieldLabel(field)}を入力してください。`;
		}
		return value.status === "resolved"
			? `${vocabulary.work} ID ${value.selectedWorkId?.slice(0, 8)} を選択済みです。`
			: value.reason ?? `${fieldLabel(field)}を解決できません。`;
	}

	function fieldLabel(field: "source" | "type" | "target"): string {
		return field === "source"
			? vocabulary.linkSource
			: field === "target"
			? vocabulary.linkTarget
			: vocabulary.linkType;
	}

	function syntaxReason(cause: AdvancedLinkParseError): string {
		switch (cause.code) {
			case "EMPTY_FIELD":
				return `${fieldLabel(cause.field)}を入力してください。`;
			case "UNKNOWN_LINK_TYPE":
				return `${vocabulary.linkType}は一覧にある標準種別を入力してください。`;
			default:
				return `${vocabulary.linkSource} :: ${vocabulary.linkType} :: ${vocabulary.linkTarget} の形式を確認してください。`;
		}
	}

	function quoteField(value: string): string {
		return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
	}

	function errorMessage(cause: unknown): string {
		return cause instanceof Error ? cause.message : String(cause);
	}

	function formatUpdatedAt(value: string): string {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ja-JP");
	}
</script>

<section class="advanced-link-editor" aria-label={vocabulary.advancedLinkEditor}>
	<h3>{vocabulary.advancedLinkEditor}</h3>
	<p class="hint">{vocabulary.linkSource} :: {vocabulary.linkType} :: {vocabulary.linkTarget}</p>
	<textarea
		rows="2"
		aria-label={`${vocabulary.advancedLinkEditor} 入力`}
		bind:value={input}
		oninput={() => void resolveInput()}
		placeholder={`"${vocabulary.work}名" :: RELATED :: "相手の${vocabulary.work}名"`}
	></textarea>
	<div class="advanced-link-status" aria-label="解決状況">
		<p class:resolved={resolution?.source.status === "resolved" || Boolean(selections.sourceWorkId)}>
			<strong>{vocabulary.linkSource}</strong><span>{fieldReason("source")}</span>
		</p>
		<p class:resolved={resolution?.type.status === "resolved"}>
			<strong>{vocabulary.linkType}</strong><span>{fieldReason("type")}</span>
		</p>
		<p class:resolved={resolution?.target.status === "resolved"}>
			<strong>{vocabulary.linkTarget}</strong><span>{fieldReason("target")}</span>
		</p>
	</div>
	{#if resolution}
		{#each [["source", resolution.source], ["target", resolution.target]] as entry}
			{@const field = entry[0] as "source" | "target"}
			{@const endpoint = entry[1] as AdvancedLinkEndpointResolution}
				{#if endpoint.status === "ambiguous"}
					<div class="advanced-link-candidates" aria-label={`${fieldLabel(field)}候補`}>
						{#each endpoint.candidates as candidate (candidate.workId)}
							<button type="button" onclick={() => selectCandidate(field, candidate.workId)}>
								{@render CandidateDetails(candidate)}
							</button>
						{/each}
					</div>
				{/if}
				{#if endpoint.status === "unresolved" && endpoint.query.trim()}
					<div class="advanced-link-stub-create">
						<button type="button" onclick={() => createStubFor(field)} disabled={submitting}>
							「{endpoint.query}」を{vocabulary.stub}として作成
						</button>
						<small>
							未解決の名前から暗黙には作成しません。{vocabulary.stub}を作成すると{fieldLabel(field)}として選択されます。
						</small>
					</div>
				{/if}
		{/each}
	{/if}
	{#if resolution?.preview}
		<p class="advanced-link-preview">
			<strong>{vocabulary.directionPreview}</strong>{resolution.preview}
		</p>
	{/if}
	{#if submitError}<p class="query-error">{submitError}</p>{/if}
	<button type="button" onclick={confirm} disabled={!ready || submitting}>
		{submitting ? "保存中…" : `${vocabulary.semanticLink}を確定`}
	</button>
</section>

{#snippet CandidateDetails(candidate: AdvancedLinkCandidate)}
	<strong>{candidate.displayName || `(空の${vocabulary.work})`}</strong>
	<small>更新 {formatUpdatedAt(candidate.updatedAt)} · ID {candidate.shortId}</small>
	{#if candidate.unplaced}
		<span>{vocabulary.unplacedInbox}</span>
	{:else}
		{#each candidate.placements as placement (placement.occurrenceId)}
			<span>
				{vocabulary.breadcrumb}: {placement.breadcrumb.join(" › ")}
				· {vocabulary.occurrence} ID {placement.occurrenceId.slice(0, 8)}
			</span>
		{/each}
	{/if}
{/snippet}
