<script lang="ts">
	import { onMount } from "svelte";
	import { RELEASE_PAGE_URL } from "../services/update_checker.ts";
	import { createHelpUpdateController } from "./help_update_controller.svelte.ts";

	type ShortcutReference = {
		label: string;
		shortcut: string;
	};

	let {
		shortcuts,
		editorShortcuts,
		onOpenOutline,
		onOpenToday,
		onOpenUnplaced,
		onOpenOptions,
		onOpenCommandPalette,
	}: {
		shortcuts: readonly ShortcutReference[];
		editorShortcuts?: readonly ShortcutReference[];
		onOpenOutline: () => void;
		onOpenToday: () => void | Promise<void>;
		onOpenUnplaced: () => void | Promise<void>;
		onOpenOptions: () => void;
		onOpenCommandPalette: () => void | Promise<void>;
	} = $props();

	const update = createHelpUpdateController();

	onMount(() => {
		void update.check();
		return () => update.dispose();
	});
</script>

<section class="help-panel" aria-labelledby="help-title">
	<header class="help-heading">
		<p class="eyebrow">IN-APP HELP</p>
		<div class="help-heading__title">
			<div>
				<h1 id="help-title">Radioraの使い方</h1>
				<p>よく使う操作を、必要なときにすぐ確認できます。</p>
			</div>
			<div class="help-key" aria-label="F1でヘルプを開く">
				<kbd>F1</kbd>
				<span>いつでも開く</span>
			</div>
		</div>
	</header>

	<div class="help-grid" aria-label="ヘルプのトピック">
		<article class="help-card help-card--accent">
			<p class="help-card__label">START HERE</p>
			<h2>アウトラインに項目を追加する</h2>
			<ol>
				<li>アウトライン末尾の入力行から、本文をその場で追加します。</li>
				<li>画面上部の入力欄は検索が中心です。候補を <kbd>Enter</kbd> で開けます。</li>
				<li>新しい本文を上部から作る場合は <kbd>Shift</kbd> + <kbd>Enter</kbd> を使い、保存先はOptionで選びます。</li>
			</ol>
			<div class="help-actions">
				<button type="button" onclick={onOpenOutline}>アウトラインを開く</button>
				<button type="button" onclick={onOpenOptions}>入力先を設定</button>
			</div>
		</article>

		<article class="help-card">
			<p class="help-card__label">ORGANIZE</p>
			<h2>アウトラインを育てる</h2>
			<ul>
				<li><kbd>Enter</kbd>で兄弟、<kbd>Shift</kbd> + <kbd>Enter</kbd>で本文中の改行を入力します。</li>
				<li><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd>で階層を移動できます。</li>
				<li>項目を選ぶと、右側の詳細ペインから配置・関係・履歴を確認できます。</li>
				<li>長い本文は項目を選んで「長文編集」を使うと、独立した編集面で扱えます。</li>
			</ul>
			<div class="help-actions">
				<button type="button" onclick={onOpenToday}>今日の更新を見る</button>
			</div>
		</article>

		<article class="help-card">
			<p class="help-card__label">CONNECT</p>
			<h2>見つけて、つなぐ</h2>
			<ul>
				<li>本文中で <kbd>@</kbd> を入力すると、別の項目への内部参照を作れます。</li>
				<li>選択した項目から意味関係を追加すると、起点・種別・終点を確認して保存できます。</li>
				<li><code>DEF</code>（定義）は、起点が終点の概念や用語を定義する有向関係です。</li>
				<li>タグ管理や重複候補は左のナビゲーションから開き、候補を確認してから操作します。</li>
			</ul>
			<p class="help-note">関係や重複候補は自動で確定されません。内容を確認してから採用してください。</p>
		</article>

		<article class="help-card">
			<p class="help-card__label">PRESERVE</p>
			<h2>保存と持ち出し</h2>
			<ul>
				<li>Markdownは現在のアウトラインを文章として書き出します。</li>
				<li>OPMLは階層と本文の交換用、JSONバックアップはRadioraの状態全体の保存用です。</li>
				<li>バックアップからの復元は現在の状態を置き換えるため、実行前に内容を確認してください。</li>
			</ul>
			<div class="help-actions">
				<button type="button" onclick={onOpenOptions}>Optionを開く</button>
				<button type="button" onclick={onOpenUnplaced}>未配置箱を見る</button>
			</div>
		</article>

		<article class="help-card help-card--wide">
			<div class="help-card__split-heading">
				<div>
					<p class="help-card__label">SHORTCUTS</p>
					<h2>キーボードで素早く操作する</h2>
				</div>
				<button type="button" onclick={onOpenCommandPalette}>コマンドパレットを開く</button>
			</div>
			<dl class="help-shortcuts">
				{#each shortcuts as shortcut (shortcut.shortcut)}
					<div class="help-shortcut">
						<dt>{shortcut.label}</dt>
						<dd><kbd>{shortcut.shortcut}</kbd></dd>
					</div>
				{/each}
			</dl>
			{#if editorShortcuts?.length}
				<h3 class="help-shortcuts__subheading">アウトライン編集</h3>
				<dl class="help-shortcuts">
					{#each editorShortcuts as shortcut (shortcut.shortcut)}
						<div class="help-shortcut">
							<dt>{shortcut.label}</dt>
							<dd><kbd>{shortcut.shortcut}</kbd></dd>
						</div>
					{/each}
				</dl>
			{/if}
			<p class="help-note">コマンドパレットは <kbd>Ctrl</kbd> + <kbd>K</kbd> で開きます。操作名を検索して実行できます。</p>
		</article>

		<aside class="help-update" aria-live="polite">
			{#if update.status === "available" && update.latest}
				<div>
					<p class="help-card__label">UPDATE AVAILABLE</p>
					<p>
						更新があります。現在版 <strong>v{update.currentVersion}</strong> ／ 最新版
						<strong>v{update.latest.version}</strong>
					</p>
				</div>
				<a href={RELEASE_PAGE_URL} target="_blank" rel="noopener noreferrer">
					リリースページを開く
				</a>
			{:else if update.status === "checking"}
				<p class="help-update__quiet">最新版を確認しています…</p>
			{:else if update.status === "current"}
				<p class="help-update__quiet">Radiora v{update.currentVersion} は最新版です。</p>
			{:else if update.status === "unavailable"}
				<p class="help-update__quiet">更新情報を確認できませんでした。</p>
			{/if}
		</aside>
	</div>
</section>

<style>
	.help-panel {
		height: 100%;
		overflow: auto;
		padding: 32px clamp(24px, 5vw, 72px) 56px;
		background: var(--surface);
	}
	.help-heading {
		max-width: 960px;
		margin-bottom: 28px;
	}
	.help-heading__title,
	.help-card__split-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
	}
	.help-heading h1 {
		margin: 4px 0 8px;
		font-size: 30px;
	}
	.help-heading p:last-child,
	.help-note,
	.help-update__quiet {
		color: var(--muted);
	}
	.help-key {
		display: grid;
		justify-items: center;
		gap: 5px;
		flex: none;
		padding-top: 5px;
		color: var(--muted);
		font-size: 10px;
	}
	.help-key kbd {
		min-width: 46px;
		padding: 8px 12px;
		border-color: var(--cyan);
		color: var(--cyan-soft);
		font-size: 13px;
		text-align: center;
	}
	.help-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(280px, 1fr));
		gap: 18px;
		max-width: 1080px;
	}
	.help-card {
		display: grid;
		align-content: start;
		gap: 12px;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-raised);
	}
	.help-card--accent {
		border-color: var(--border-bright);
		box-shadow: inset 2px 0 var(--cyan);
	}
	.help-card--wide,
	.help-update {
		grid-column: 1 / -1;
	}
	.help-card h2,
	.help-card p,
	.help-card ol,
	.help-card ul,
	.help-card dl,
	.help-update p {
		margin: 0;
	}
	.help-card h2 {
		font-family: Georgia, "Noto Serif JP", serif;
		font-size: 20px;
		font-weight: normal;
		color: #edf9fa;
	}
	.help-card__label {
		color: var(--cyan);
		font-size: 9px;
		letter-spacing: .16em;
	}
	.help-card ol,
	.help-card ul {
		display: grid;
		gap: 8px;
		padding-left: 20px;
		color: #afc1c9;
		font-size: 12px;
		line-height: 1.65;
	}
	.help-card li::marker {
		color: var(--cyan);
	}
	.help-card kbd,
	.help-shortcut kbd {
		display: inline-block;
		padding: 1px 5px;
		border: 1px solid var(--border-bright);
		border-radius: 4px;
		background: #04080d;
		color: var(--cyan-soft);
		font-family: inherit;
		font-size: .9em;
		white-space: nowrap;
	}
	.help-note {
		padding: 8px 10px;
		border-left: 2px solid var(--amber);
		background: var(--surface-hover);
		font-size: 11px;
		line-height: 1.6;
	}
	.help-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 2px;
	}
	.help-card__split-heading button {
		flex: none;
	}
	.help-shortcuts {
		display: grid;
		grid-template-columns: repeat(2, minmax(240px, 1fr));
		gap: 6px 12px;
	}
	.help-shortcuts__subheading {
		margin: 18px 0 8px;
		font-size: 12px;
		color: var(--muted);
	}
	.help-shortcut {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		font-size: 11px;
	}
	.help-shortcut dt {
		color: var(--text);
	}
	.help-shortcut dd {
		margin: 0;
	}
	.help-update {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		min-height: 38px;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		font-size: 11px;
	}
	.help-update div {
		display: grid;
		gap: 4px;
	}
	.help-update a {
		flex: none;
		color: var(--cyan-soft);
	}
	.help-update__quiet {
		font-size: 10px;
	}
	@media (max-width: 900px) {
		.help-grid,
		.help-shortcuts {
			grid-template-columns: 1fr;
		}
		.help-card--wide,
		.help-update {
			grid-column: auto;
		}
		.help-update {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
