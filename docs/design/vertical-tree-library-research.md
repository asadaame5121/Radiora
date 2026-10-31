# 縦Treeのライブラリ調査

調査日: 2026-10-30（日本時間）。状態: 採用候補の評価。依存追加・製品実装・実機性能検証は未実施。
既存の[移行調査](tauri-migration-research.md)を、Topicカード内にアウトラインを持つ縦方向の系譜表示について補足する。
製品モデル・保存・Undoの正本は[v3決定記録](v3-model-decisions.md)、実装順序は[縦Tree実装計画](vertical-tree-implementation-plan.md)を参照する。

2026-10-31追補:
Rust構造計算のpetgraphは[製品Rust依存](v3-rust-dependencies.md)で採用し、coreのCargoへ追加した。
以下の「候補」「未追加」は2026-10-30調査時点の記録として読む。

## 推奨

描画・pan/zoomは **`@xyflow/svelte`**、自動配置の第一候補は **`elkjs`**。 Topic内のLoroTreeをSvelte
Flowの親子nodeへ変換せず、一つのcustom nodeの内部Viewとして描画する。 本文編集は既存/新v3
OutlineのControllerとBackend commandを再利用し、Svelte Flowへ本文・LoroDoc・Undoの所有を移さない。

Svelte Flowは外部layout engineとの統合を案内しており、自動配置自体を内蔵しない。
Dagreは導入が簡単で、ELKはportsやedge routing等の制御が広い。
この選定は機能適合に基づく提案であり、Radioraでの速度比較結果ではない。
[公式Layouting overview](https://svelteflow.dev/learn/layouting/overview)

## 取得時点の公開版とライセンス

2026-10-30にnpm registryの `/latest` endpointを直接取得した結果。
「最新」の継続保証ではなく、実装PRで固定版・lockfile・transitive dependencyを再確認する。

| package          | registry latest | license metadata            | 扱い                                                    |
| ---------------- | --------------- | --------------------------- | ------------------------------------------------------- |
| `@xyflow/svelte` | 1.7.0           | MIT                         | 描画・操作の採用予定。peer dependencyはSvelte `^5.25.0` |
| `elkjs`          | 0.12.1          | EPL-2.0 OR GPL-3.0-or-later | レイアウトの第一候補                                    |
| `@dagrejs/dagre` | 3.1.3           | MIT                         | ELKと同時採用せず、比較/代替候補                        |

一次情報:
[Svelte Flow registry](https://registry.npmjs.org/@xyflow/svelte/latest)、[elkjs registry](https://registry.npmjs.org/elkjs/latest)、[Dagre registry](https://registry.npmjs.org/@dagrejs/dagre/latest)。
Svelte
Flowの[package定義](https://github.com/xyflow/xyflow/blob/main/packages/svelte/package.json)でもversion・MIT・peer
dependencyを確認した。 elkjsのGitHub masterは調査時点で0.13.0を示したが、registry
latestの0.12.1と混同しない。 配布時は採用したartifactのLICENSE/NOTICEと再配布条件を確認する。
[elkjs package定義](https://github.com/kieler/elkjs/blob/master/package.json)、[elkjs LICENSE](https://github.com/kieler/elkjs/blob/0.12.1/LICENSE.md)

## Svelte Flowで任せられること

- Svelte componentをcustom nodeとして登録できるため、Topicカードを通常のSvelte
  Viewとして実装できる。 [Custom Nodes](https://svelteflow.dev/learn/customization/custom-nodes)
- v1はSvelte 5を使う。nodes/edgesは `$state.raw`
  を使う例に従い、変更時に対象objectと配列を置換する。
  内部objectの直接変更で更新されると仮定しない。
  [v1 migration](https://svelteflow.dev/learn/troubleshooting/migrate-to-v1)、[Svelte
  $state.raw](https://svelte.dev/docs/svelte/$state#state.raw)
- nodeの実測寸法は `measured.width/height`
  に保持される。実測値へ直接書かず、必要ならwidth/heightでサイズを制御する。 初期測定の完了は
  `useNodesInitialized`、handle数/位置の変更通知は `useUpdateNodeInternals` を使える。
  これらはELKの自動再実行を意味しない。
  [Node](https://svelteflow.dev/api-reference/types/node)、[initialization hook](https://svelteflow.dev/api-reference/hooks/use-nodes-initialized)、[handle更新hook](https://svelteflow.dev/api-reference/hooks/use-update-node-internals)
- 編集領域には `nodrag`、`nopan`、必要なscroll領域に `nowheel` を指定できる。
  これだけでEnter/Tab/Undo/IMEの競合まで解決するわけではない。
  [Utility Classes](https://svelteflow.dev/learn/customization/utility-classes)
- `onlyRenderVisibleElements`
  はviewport内のnodes/edgesだけを描画する選択肢。既定falseで、判定overheadもある。
  `getViewport/setViewport`、座標変換、fit等の公開APIを利用できる。
  [SvelteFlow API](https://svelteflow.dev/api-reference/svelte-flow)、[useSvelteFlow](https://svelteflow.dev/api-reference/hooks/use-svelte-flow)

設計上の推奨: Flowのnode削除/接続/自由dragは、対応する製品commandを実装するまで無効にする。
見た目のnode削除をTombstoneやRelation削除の代わりにしない。
編集領域のキーはOutlineが処理し、workspace Undoへ接続する。 画面全体のkeyboard
accessibilityを一括無効にせず、カード選択と本文編集のfocus境界を明示する。

## ELKとDagreの比較

| 観点           | elkjs                                                 | Dagre                                      |
| -------------- | ----------------------------------------------------- | ------------------------------------------ |
| 配置入力       | nodeごとのwidth/height、edges、ports等                | nodeごとのwidth/height、edges              |
| 縦の有向グラフ | layered + DOWNを候補にする                            | rankdir TBを候補にする                     |
| 可変サイズ     | 測定済み寸法を渡して再配置                            | 測定済み寸法を渡して再配置                 |
| edge経路       | Layeredはorthogonal/spline/straight、portsに対応      | edge pointsを返す。Radioraの描画へ別途接続 |
| 非同期/Worker  | Promise API、workerUrl/workerFactory、terminateWorker | layout呼出しは同期。必要なら別途Worker化   |
| 主な負担       | option選定、Worker assetとbundle、制約の検証          | 細かなrouting/制約の追加実装               |

根拠:
[elkjs README](https://github.com/kieler/elkjs)、[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)、[Dagre公式Wiki](https://github.com/dagrejs/dagre/wiki)、[Svelte Flow layout比較](https://svelteflow.dev/learn/layouting/overview)。

ELK Layeredは自己loop・multi edgeを扱い、cycle breaking optionを持つ。 しかしengineのcycle
breaking/rankは、Radioraの「FROM系Relationだけで世代を進める」
「循環memberをKnot帯へ置く」「残るDAGで最深親+1」の意味を保証しない。
元Relationを変更せず、Radiora側で世代・循環membership・表示edgeを決め、engineには配置の入力を渡す。
既存意味との同値性をfixtureで確認できなければ、ELKの自由なrankを採用しない。
[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)、[既存移行計画の契約](tauri-migration-plan.md)

既存の世代番号の進行方向と、新UIの上→下の派生方向は別の確認事項である。
保存Relationのsource/target、表示矢印、世代番号を同じ向きだと仮定しない。
派生元を上・派生先を下へ置く案は、既存仕様を単純に回転した同値変更とは扱わない。
方向の最終契約は実装計画で固定し、その契約をELKのDOWN入力へ明示的に写像する。

推奨: まず固定fixtureで世代制約・Knot帯を維持した可変高カード配置が成立するかを評価する。
ELK結果のyだけを後から上書きするとedge routeや重なり制約が崩れるため、制約付き入力/配置を試験する。
成立しなければ世代ごとの帯配置をRadiora側で行う案と比較し、使わないlayout依存は残さない。
d3-hierarchyは単一rootのtree向けで、この複数親系譜の第一候補にしない。
[公式layout比較](https://svelteflow.dev/learn/layouting/overview)

## 可変高・編集・非同期公開の契約案

以下は公式APIの保証ではなく、Radioraで追加実装・検証する設計案。

1. 投影データ版・filter key・表示Topic集合・寸法版を入力snapshotへ固定する。
2. 実測寸法が変化したときだけlayout要求をまとめる。本文文字変更でも高さが変わらなければ再配置不要。
3. 一つの実行中要求に対して最新のpending入力だけを残し、古いlayoutのqueueを増やさない。
4. 成功・失敗・finallyのすべてで要求世代と入力keyを検証する。古い結果は位置/error/loadingへ公開しない。
5. 編集中カードのDOMを安定IDで維持する。composition中はそのeditorをunmount/差替えせず、再配置を遅延またはanchor補正する。
6. 更新のたびにfitViewせず、zoomと編集中カードの画面位置を保つ。明示fit、初期表示、移動先revealを区別する。
7. unmount/disposeでtimer/observerを解放し、要求公開を失効させる。Workerを使う場合は所有者が終了する。

elkjsはPromiseで結果を返すため、Promiseであるだけで別thread実行されるとは仮定しない。
Worker構成ではTauri配布buildのasset URL/CSP/WebView2を確認する。 `terminateWorker`
はWorkerの終了であり、任意の古い要求だけを取消すAPIとして扱わない。
[elkjs API](https://github.com/kieler/elkjs#api)

DOM測定はSvelteの更新完了後に行う。 `tick` はpending
DOM更新の完了を待つが、backend保存完了の意味は持たない。 `$effect`
はDOM/外部libraryとの接続とcleanupに限定し、二方向state同期を作らない。
[Svelte lifecycle/tick](https://svelte.dev/docs/svelte/lifecycle-hooks#tick)、[Svelte
$effect](https://svelte.dev/docs/svelte/$effect)

## 規模と未検証事項

Flowのviewport cullingはカード内の全Blockの仮想化でも、graph計算/データ取得の削減でもない。
cullingで編集中nodeが画面外へ出てunmountされる場合、draft・composition・caretが失われないことを確認する。
初回は選択カードだけeditorを起動し、他カードは軽量outline表示とする案を実測で評価する。
長い文書でカード内仮想化が必要なら、既存Outlineの方式とfold/Hoist契約を再利用する。
cullingを有効にする判断はDOM数・heap・frame time・入力遅延の比較後に行う。

実機受入として、IME確定Enter、Tab/Shift+Tab、選択範囲、clipboard、共通Undo/Redo、
保存失敗時draft、pan/zoom中の編集、再配置後caret、画面外/画面復帰、画面離脱中の旧layout応答、
長い日本語・空Topic・巨大文書・多数の兄弟・diamond・自己loop・循環前後・Missingを検証する。
Worker導入やノード仮想化だけで性能合格としない。

## Rustへ構造計算を移す場合の任意候補

`petgraph`は初回表示に必須の追加依存ではない。既存TSの循環検出・投影を再利用し、
Backendへの移植時だけ候補とする。調査時docs.rsは0.8.3、同版crates.io metadataは
`MIT OR Apache-2.0`、rust-version 1.64。採用時にCargo.lockとfeaturesを固定する。
[petgraph docs](https://docs.rs/petgraph/0.8.3/petgraph/)、[同版metadata](https://crates.io/api/v1/crates/petgraph/0.8.3)

`tarjan_scc`はO(V+E)だが再帰実装であり、既存の反復Tarjanと同じstack特性ではない。
成分内のnode順は任意なので、UIの安定順序として直接使わない。
`kosaraju_scc`は反復実装の代替候補だが、Tarjan採用の製品契約を変更するなら別判断とする。
どのSCC算法でも単一node成分は自己loopを別途確認して循環memberへ含める。
`toposort`は自己loopを含む循環でErrになるため、元Relation全体をそのまま渡して
Knot/世代が自動的に得られるとは仮定しない。
[Tarjan](https://docs.rs/petgraph/0.8.3/petgraph/algo/scc/tarjan_scc/fn.tarjan_scc.html)、
[Kosaraju](https://docs.rs/petgraph/0.8.3/petgraph/algo/scc/kosaraju_scc/fn.kosaraju_scc.html)、
[toposort](https://docs.rs/petgraph/0.8.3/petgraph/algo/fn.toposort.html)

今回は公式仕様と候補版を確認した。bundle実容量、WebView2上のIME/性能、ELKの世代制約適合は未検証。
依存の追加、既存D3の撤去、未要求の接続編集・自由配置・別state管理libraryの導入は行わない。
