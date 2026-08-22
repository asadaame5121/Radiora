<script lang="ts">
	import { isSymmetricLinkType, LINK_TYPES } from "../domain/models.ts";
	import type {
		OutlineLinkSelectionHandlers,
		OutlineLinkSelectionViewState,
	} from "./outline_row_types.ts";

	let {
		state,
		handlers,
	}: {
		state: OutlineLinkSelectionViewState;
		handlers: OutlineLinkSelectionHandlers;
	} = $props();

	function selectType(value: string): void {
		const type = LINK_TYPES.find((candidate) => candidate === value);
		if (type) handlers.setType(type);
	}

	function selectDirection(value: string): void {
		handlers.setDirection(value === "incoming" ? "incoming" : "outgoing");
	}
</script>

<section class="link-selection-bar" aria-label="意味関係を追加中">
	<div class="link-selection-heading">
		<div>
			<strong>意味関係を追加中</strong>
			<span>起点: {state.originDisplayName}</span>
		</div>
		<span class="link-selection-count" aria-live="polite">{state.selectedWorkCount}件選択</span>
	</div>

	<div class="link-selection-fields">
		<label>
			<span>種類</span>
			<select
				value={state.selectedType}
				onchange={(event) => selectType(event.currentTarget.value)}
				disabled={state.submitting}
				aria-label="意味関係の種類"
			>
				{#each LINK_TYPES as type}
					<option value={type}>{type}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>向き</span>
			<select
				value={state.direction}
				onchange={(event) => selectDirection(event.currentTarget.value)}
				disabled={state.submitting || isSymmetricLinkType(state.selectedType)}
				aria-label="意味関係の向き"
			>
				<option value="outgoing">起点 → 選択項目</option>
				<option value="incoming">選択項目 → 起点</option>
			</select>
		</label>
		<label class="link-selection-reason">
			<span>説明（任意）</span>
			<input
				value={state.reason}
				oninput={(event) => handlers.setReason(event.currentTarget.value)}
				disabled={state.submitting}
				placeholder="この関係の理由"
			/>
		</label>
	</div>

	{#if isSymmetricLinkType(state.selectedType)}
		<p class="link-selection-hint">{state.selectedType}は対称な関係のため、向きは使われません。</p>
	{/if}
	{#if state.error}<p class="link-selection-error" role="alert">{state.error}</p>{/if}

	<div class="link-selection-actions">
		<button type="button" class="cancel" onclick={handlers.cancel} disabled={state.submitting}>キャンセル</button>
		<button
			type="button"
			class="connect"
			onclick={() => void handlers.submit()}
			disabled={state.submitting || state.selectedWorkCount === 0}
		>
			{state.submitting ? "接続中…" : `${state.selectedWorkCount}件を接続`}
		</button>
	</div>
</section>

<style>
	.link-selection-bar {
		position: sticky;
		top: 0;
		z-index: 3;
		display: grid;
		gap: 9px;
		margin: 0 0 14px;
		padding: 10px;
		border: 1px solid var(--cyan);
		border-radius: 8px;
		background: color-mix(in srgb, var(--surface-raised) 94%, var(--cyan));
		box-shadow: 0 6px 18px rgb(0 0 0 / 22%);
	}
	.link-selection-heading,
	.link-selection-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.link-selection-heading > div {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
		min-width: 0;
	}
	.link-selection-heading strong {
		color: var(--text);
		font-size: 12px;
	}
	.link-selection-heading span,
	.link-selection-count {
		color: var(--muted);
		font-size: 10px;
	}
	.link-selection-count {
		flex: none;
		color: var(--cyan-soft);
	}
	.link-selection-fields {
		display: grid;
		grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr) minmax(0, 2fr);
		gap: 6px;
	}
	.link-selection-fields label {
		display: grid;
		gap: 4px;
		min-width: 0;
		color: var(--muted);
		font-size: 10px;
	}
	.link-selection-fields select,
	.link-selection-fields input {
		width: 100%;
		min-width: 0;
		padding: 6px 7px;
		font-size: 11px;
	}
	.link-selection-hint,
	.link-selection-error {
		margin: 0;
		padding: 5px 7px;
		border-left: 2px solid var(--cyan);
		background: var(--surface-hover);
		color: var(--muted);
		font-size: 10px;
	}
	.link-selection-error {
		border-color: var(--red);
		color: #ffb8af;
	}
	.link-selection-actions button {
		padding: 6px 10px;
		font-size: 10px;
	}
	.link-selection-actions .cancel {
		border-color: transparent;
		background: transparent;
		color: var(--muted);
	}
	.link-selection-actions .connect {
		border-color: var(--cyan);
		background: var(--cyan);
		color: #061317;
	}
	.link-selection-actions .connect:disabled {
		border-color: var(--border);
		background: var(--surface-hover);
		color: var(--muted);
	}
	@media (max-width: 720px) {
		.link-selection-fields {
			grid-template-columns: 1fr 1fr;
		}
		.link-selection-reason {
			grid-column: 1 / -1;
		}
	}
</style>
