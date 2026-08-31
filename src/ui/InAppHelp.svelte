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
				<p>思考のアウトライン作成・系統管理・意味関係の連携を、必要なときに確認できます。</p>
			</div>
			<div class="help-key" aria-label="F1でヘルプを開く">
				<kbd>F1</kbd>
				<span>いつでも開く</span>
			</div>
		</div>
	</header>

	<div class="help-grid" aria-label="ヘルプのトピック">
		<article class="help-card help-card--accent">
			<p class="help-card__label">START & CAPTURE</p>
			<h2>アウトラインとクイック入力</h2>
			<ol>
				<li>アウトライン末尾の入力行から項目を追加し、<kbd>Enter</kbd>で兄弟、<kbd>Tab</kbd>で階層化します。</li>
				<li>「クイック入力」で、思いついたテキストをすぐ記録できます。</li>
				<li>クイック入力の保存先は、Option画面から「ルート直下」または「未配置箱」を選択できます。</li>
			</ol>
			<div class="help-actions">
				<button type="button" onclick={onOpenOutline}>アウトラインを開く</button>
				<button type="button" onclick={onOpenUnplaced}>未配置箱を見る</button>
			</div>
		</article>

		<article class="help-card">
			<p class="help-card__label">VIEW & EDIT</p>
			<h2>日々の確認と長文執筆</h2>
			<ul>
				<li>「今日」ビューで日々の更新履歴やタイムラインを確認できます。</li>
				<li>重要な項目には「栞」を挟んで素早くアクセスできます。</li>
				<li>最後に作業していた「再開位置」は自動保持され、作業をスムーズに再開できます。</li>
				<li>集中執筆用の「長文編集モード」でアウトラインと行き来しながら編集できます。</li>
				<li><kbd>Enter</kbd>で兄弟、<kbd>Shift</kbd> + <kbd>Enter</kbd>で本文中の改行を入力します。</li>
				<li><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd>で階層を移動できます。</li>
				<li>項目を選ぶと、右側の詳細ペインから配置・関係・履歴を確認できます。</li>
				<li>長い本文は項目を選んで「原稿として開く」を使うと、独立した編集面で扱えます。</li>
			</ul>
			<div class="help-actions">
				<button type="button" onclick={onOpenToday}>今日の更新を見る</button>
			</div>
		</article>

		<article class="help-card">
			<p class="help-card__label">CONNECT & REFERENCE</p>
			<h2>参照と意味関係</h2>
			<ul>
				<li>本文中で <kbd>[[</kbd> を入力すると、既存の項目や版への「内部参照」（Work/Revisionリンク）を作成します。</li>
				<li>本文中で <kbd>@</kbd> を入力すると、項目間の連想をつなぐ「意味関係検索」を実行します（内部参照ではありません）。</li>
				<li>詳細ペインから意味関係（<code>DEF</code> 定義関係など、起点・種別・終点）を明示的に結べます。</li>
				<li>本文中で <kbd>@</kbd> を入力すると、別の項目へのリンクを作れます。</li>
				<li>選択した項目から関連を追加すると、リンク元・種類・リンク先を確認して保存できます。</li>
				<li><code>DEF</code>（定義）は、リンク元がリンク先の概念や用語を定義する有向関係です。</li>
				<li>タグ管理や重複候補は左のナビゲーションから開き、候補を確認してから操作します。</li>
			</ul>
			<p class="help-note">意味関係や参照リンクは自動確定されません。内容を確認してから保存してください。</p>
		</article>

		<article class="help-card">
			<p class="help-card__label">LINEAGE & REVISION</p>
			<h2>版・別稿・系統と復元</h2>
			<ul>
				<li>作業中の本文を「版として残す」で確定し、新しい「別稿（Branch）」として分岐できます。</li>
				<li>自動記録される「復旧履歴（Recovery Snapshot）」から、過去の編集状態へ安全に復帰できます。</li>
				<li>「比較」ペインで2つの版や作業コピーの差分（追加・削除・変更なし）を確認できます。</li>
				<li>「全体系統」と「版系統」で関係履歴を確認でき、Tree表示ではChronology/Lineageを切り替えられます。</li>
			</ul>
		</article>

		<article class="help-card">
			<p class="help-card__label">DISCOVERY & STUB</p>
			<h2>発見・Query・重複候補</h2>
			<ul>
				<li>「Query」を実行し、条件に一致する項目を投影表示できます。</li>
				<li>「Stub一覧」でリンク先が未作成の項目を一覧し、作成文脈を確認して実体化できます。</li>
				<li>「重複候補」からタイトルや意味関係の一致を根拠に、統合・関連付け・却下を判断できます。</li>
			</ul>
		</article>

		<article class="help-card">
			<p class="help-card__label">STORAGE & PRESERVE</p>
			<h2>保存・移行・バックアップ</h2>
			<ul>
				<li>データはローカルの <strong>SQLite</strong> に安全に保存されます。旧SurrealDBデータをお持ちの場合は、READMEの移行手順をご確認ください。</li>
				<li>Markdown書き出しはRadiora形式・ポータブル形式・Obsidian Wikiリンク形式に対応しています。</li>
				<li>OPML（階層交換）の取り込み/書き出し、および完全JSONバックアップからの復元に対応しています。</li>
			</ul>
			<div class="help-actions">
				<button type="button" onclick={onOpenOptions}>Optionを開く</button>
				<button type="button" onclick={onOpenUnplaced}>未配置項目を見る</button>
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
		font-family: var(--font-serif);
		font-size: 20px;
		font-weight: normal;
		color: var(--text);
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
		color: var(--text);
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
		background: var(--surface);
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
