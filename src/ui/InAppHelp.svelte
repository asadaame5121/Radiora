<script lang="ts">
	type ShortcutReference = {
		label: string;
		shortcut: string;
	};

	let {
		shortcuts,
		onOpenOutline,
		onOpenToday,
		onOpenUnplaced,
		onOpenOptions,
		onOpenCommandPalette,
	}: {
		shortcuts: readonly ShortcutReference[];
		onOpenOutline: () => void;
		onOpenToday: () => void | Promise<void>;
		onOpenUnplaced: () => void | Promise<void>;
		onOpenOptions: () => void;
		onOpenCommandPalette: () => void | Promise<void>;
	} = $props();
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
			<p class="help-note">コマンドパレットは <kbd>Ctrl</kbd> + <kbd>K</kbd> で開きます。操作名を検索して実行できます。</p>
		</article>
	</div>
</section>
