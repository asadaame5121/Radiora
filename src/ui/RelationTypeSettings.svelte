<script lang="ts">
	import type {
		RelationTypeDefinition,
		RelationTypeDirection,
	} from "../domain/models.ts";
	import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";
	import { useUiVocabulary } from "./ui_vocabulary_context.ts";

	let {
		relationTypeDefinitions,
		startupReady,
		onCreateRelationTypeDefinition,
	}: {
		relationTypeDefinitions?: readonly RelationTypeDefinition[];
		startupReady: boolean;
		onCreateRelationTypeDefinition?: (input: {
			name: string;
			direction: RelationTypeDirection;
		}) => Promise<void>;
	} = $props();

	const vocabulary = useUiVocabulary();
	const definitions = $derived(relationTypeDefinitions ?? BUILT_IN_RELATION_TYPES);

	let newRelationName = $state("");
	let newRelationDirection = $state<RelationTypeDirection>("directed");
	let relationSubmitting = $state(false);
	let relationStatusMessage = $state("");
	let relationErrorMessage = $state("");

	const canSubmitRelation = $derived(
		startupReady &&
			Boolean(onCreateRelationTypeDefinition) &&
			!relationSubmitting &&
			Boolean(newRelationName.trim()),
	);

	async function submitCreateRelation(): Promise<void> {
		if (!canSubmitRelation || !onCreateRelationTypeDefinition) return;
		const name = newRelationName.trim();
		relationSubmitting = true;
		relationStatusMessage = "";
		relationErrorMessage = "";
		try {
			await onCreateRelationTypeDefinition({
				name,
				direction: newRelationDirection,
			});
			newRelationName = "";
			newRelationDirection = "directed";
			relationStatusMessage = `関係型「${name.toUpperCase()}」を追加しました。`;
		} catch (cause) {
			relationErrorMessage = cause instanceof Error ? cause.message : String(cause);
		} finally {
			relationSubmitting = false;
		}
	}
</script>

<section class="option-card" aria-labelledby="option-relations-title">
	<h2 id="option-relations-title">{vocabulary.semanticLink}の種類</h2>
	<p>{vocabulary.work}同士をつなぐ関係の型（組み込みおよびカスタム）を管理します。</p>

	<div class="relation-type-list">
		{#each definitions as def (def.name)}
			<div class="relation-type-item">
				<span class="relation-type-name">{def.name}</span>
				<span class="relation-type-direction">{def.direction === "symmetric" ? "双方向 (↔)" : "有向 (→)"}</span>
				<span class="relation-type-badge">{def.builtIn ? "組み込み" : "カスタム"}</span>
			</div>
		{/each}
	</div>

	<form class="relation-type-form" onsubmit={(event) => { event.preventDefault(); void submitCreateRelation(); }}>
		<label>
			<span>新しい関係型の名前</span>
			<input
				type="text"
				maxlength={64}
				placeholder="例: CAUSES, PRECEDES"
				bind:value={newRelationName}
				disabled={!startupReady || !onCreateRelationTypeDefinition || relationSubmitting}
			/>
		</label>
		<div class="relation-direction-radios">
			<label>
				<input
					type="radio"
					name="relation-direction"
					value="directed"
					checked={newRelationDirection === "directed"}
					disabled={!startupReady || !onCreateRelationTypeDefinition || relationSubmitting}
					onchange={() => (newRelationDirection = "directed")}
				/>
				有向（向きあり）
			</label>
			<label>
				<input
					type="radio"
					name="relation-direction"
					value="symmetric"
					checked={newRelationDirection === "symmetric"}
					disabled={!startupReady || !onCreateRelationTypeDefinition || relationSubmitting}
					onchange={() => (newRelationDirection = "symmetric")}
				/>
				双方向（対称）
			</label>
		</div>
		<div class="option-actions">
			<button type="submit" disabled={!canSubmitRelation}>関係型を追加</button>
		</div>
		{#if relationStatusMessage}
			<p class="relation-status-message" role="status">{relationStatusMessage}</p>
		{/if}
		{#if relationErrorMessage}
			<p class="relation-error-message" role="alert">{relationErrorMessage}</p>
		{/if}
	</form>
</section>

<style>
	.option-card {
		display: grid;
		align-content: start;
		gap: 14px;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-raised);
	}
	.option-card h2,
	.option-card p {
		margin: 0;
	}
	.option-card > p {
		color: var(--muted);
	}
	.option-card label:not(.relation-direction-radios label) {
		display: grid;
		gap: 6px;
	}
	.option-card label > span {
		color: var(--muted);
		font-size: 11px;
	}
	.option-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.relation-type-list {
		display: grid;
		gap: 6px;
		max-height: 180px;
		overflow-y: auto;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.relation-type-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 12px;
	}
	.relation-type-name {
		font-weight: bold;
		font-family: monospace;
	}
	.relation-type-direction {
		color: var(--muted);
		font-size: 11px;
	}
	.relation-type-badge {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--border) 60%, transparent);
		color: var(--muted);
	}
	.relation-type-form {
		display: grid;
		gap: 10px;
	}
	.relation-direction-radios {
		display: flex;
		gap: 14px;
		font-size: 12px;
	}
	.relation-direction-radios label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}
	.relation-status-message {
		color: var(--cyan, #25c6d1);
		font-size: 12px;
	}
	.relation-error-message {
		color: var(--danger, #b42318);
		font-size: 12px;
	}
</style>
