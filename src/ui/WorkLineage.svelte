<script lang="ts">
	import type { Branch, Revision } from "../domain/models";
	import type { WorkLineageProjection } from "../services/branch_service";
	import { useUiVocabulary } from "./ui_vocabulary_context";

	let {
		projection,
		onCompare,
		onBack,
	}: {
		projection: WorkLineageProjection;
		onCompare: (scope: "branch" | "revision", id: string) => void;
		onBack: () => void;
	} = $props();

	const vocabulary = useUiVocabulary();
	const revisionById = $derived(new Map(projection.revisions.map((revision) => [revision.id, revision])));
	const branchesByHead = $derived.by(() => {
		const result = new Map<string, Branch[]>();
		for (const branch of projection.branches) {
			if (!branch.headRevisionId) continue;
			const entries = result.get(branch.headRevisionId) ?? [];
			entries.push(branch);
			result.set(branch.headRevisionId, entries);
		}
		return result;
	});

	function revisionTitle(revision: Revision): string {
		return revision.message ?? `${vocabulary.revision} ${revision.id.slice(0, 8)}`;
	}

	function createdLabel(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? "日時不明"
			: date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
	}
</script>

<section class="work-lineage" aria-label={vocabulary.workLineage}>
	<header>
		<div>
			<button class="back-button" type="button" onclick={onBack}>← アウトラインに戻る</button>
			<p class="eyebrow">VERSION LINEAGE</p>
			<h1>{vocabulary.workLineage}</h1>
		</div>
		<p>
			この{vocabulary.work}の{vocabulary.revision}、{vocabulary.branch}、
			{vocabulary.merge}だけを表示します。
		</p>
	</header>

	{#if projection.revisions.length === 0}
		<p class="lineage-empty">保存済みの{vocabulary.revision}はありません。</p>
	{:else}
		<ol class="revision-lineage">
			{#each projection.revisions as revision (revision.id)}
				<li class:merge={revision.kind === "merge"}>
					<div class="revision-card">
						<div class="revision-title">
							<span>{revision.kind === "merge" ? vocabulary.merge : vocabulary.revision}</span>
							<strong>{revisionTitle(revision)}</strong>
							<time datetime={revision.createdAt}>{createdLabel(revision.createdAt)}</time>
						</div>

						{#if branchesByHead.get(revision.id)?.length}
							<div class="branch-heads" aria-label={`${vocabulary.branch}の先端`}>
								{#each branchesByHead.get(revision.id) ?? [] as branch (branch.id)}
									<span class:archived={Boolean(branch.archivedAt)}>
										{vocabulary.branch}: {branch.name}{branch.archivedAt ? "（保管済み）" : ""}
									</span>
								{/each}
							</div>
						{/if}

						<div class="revision-parents">
							<span>元になった{vocabulary.revision}</span>
							{#each revision.parentRevisionIds as parentId}
								<code>{revisionById.has(parentId) ? revisionTitle(revisionById.get(parentId)!) : parentId}</code>
							{:else}
								<em>なし</em>
							{/each}
						</div>

						<button onclick={() => onCompare("revision", revision.id)}>
							この{vocabulary.revision}を{vocabulary.comparisonPane}
						</button>
					</div>
				</li>
			{/each}
		</ol>
	{/if}

	<section class="unconfirmed-branches" aria-label={vocabulary.branch}>
		<h2>{vocabulary.branch}</h2>
		{#each projection.branches as branch (branch.id)}
			<p>
				<strong>{branch.name}</strong>
				<span>
					{branch.headRevisionId
						? `${vocabulary.revision}あり`
						: `未確定の${vocabulary.workingCopy}`}
				</span>
				<button onclick={() => onCompare("branch", branch.id)}>
					{vocabulary.workingCopy}を{vocabulary.comparisonPane}
				</button>
			</p>
		{:else}
			<p class="lineage-empty">{vocabulary.branch}はありません。</p>
		{/each}
	</section>
</section>

<style>
	.work-lineage {
		min-width: 0;
		overflow: auto;
		padding: 28px clamp(24px, 5vw, 72px) 60px;
		background:
			radial-gradient(circle at 18% 10%, color-mix(in srgb, var(--cyan) 6%, transparent) 0, transparent 36%),
			var(--bg);
	}
	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 30px;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--border);
	}
	header p,
	header h1 {
		margin: 0;
	}
	header h1 {
		margin-top: 4px;
		color: var(--text);
		font: 25px var(--font-serif);
	}
	.back-button {
		margin-bottom: 14px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.back-button:hover { color: var(--text); }
	header > p {
		max-width: 420px;
		color: var(--muted);
		font-size: 11px;
		line-height: 1.6;
		text-align: right;
	}
	.revision-lineage {
		position: relative;
		max-width: 820px;
		margin: 28px auto;
		padding: 0;
		list-style: none;
	}
	.revision-lineage::before {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 16px;
		width: 1px;
		background: var(--border);
		content: "";
	}
	.revision-lineage li {
		position: relative;
		padding: 0 0 20px 48px;
	}
	.revision-lineage li::before {
		position: absolute;
		top: 18px;
		left: 11px;
		width: 11px;
		height: 11px;
		border: 2px solid var(--cyan);
		border-radius: 50%;
		background: var(--bg);
		box-shadow: 0 0 8px color-mix(in srgb, var(--cyan) 60%, transparent);
		content: "";
	}
	.revision-lineage li.merge::before {
		border-color: var(--amber);
		border-radius: 2px;
		transform: rotate(45deg);
	}
	.revision-card {
		padding: 15px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.revision-title {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
	}
	.revision-title > span,
	.branch-heads span {
		padding: 2px 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--cyan);
		font-size: 9px;
	}
	.revision-title strong {
		color: var(--text);
		font-size: 13px;
	}
	.revision-title time {
		color: var(--muted);
		font-size: 10px;
	}
	.branch-heads {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}
	.branch-heads span.archived {
		opacity: .55;
	}
	.revision-parents {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
		margin-top: 12px;
		color: var(--muted);
		font-size: 10px;
	}
	.revision-parents code {
		padding: 3px 6px;
		border-radius: 4px;
		background: var(--surface-raised);
		color: var(--text);
	}
	.revision-parents em {
		font-style: normal;
	}
	.revision-card button {
		margin-top: 12px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 10px;
		line-height: 27px;
		cursor: pointer;
	}
	.revision-card button:hover {
		border-color: var(--cyan);
		color: var(--cyan);
	}
	.unconfirmed-branches {
		max-width: 820px;
		margin: 0 auto;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}
	.unconfirmed-branches h2 {
		margin: 0 0 10px;
		color: var(--muted);
		font-size: 12px;
	}
	.unconfirmed-branches p:not(.lineage-empty) {
		display: flex;
		justify-content: space-between;
		margin: 6px 0;
		color: var(--text);
		font-size: 11px;
	}
	.unconfirmed-branches button {
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 10px;
		cursor: pointer;
	}
	.unconfirmed-branches span,
	.lineage-empty {
		color: var(--muted);
	}
	.lineage-empty {
		margin: 36px auto;
		font-size: 12px;
		text-align: center;
	}
</style>
