# Radiora 性能改修計画

作成: 2026-10-09。根拠: [性能監査](performance-audit-2026-10-08.md)。監査対象HEAD: `9c8aaa7b08d0891e3d4b5248efccb849618017b8`。
本書は改修計画。実装・依存関係・DB変更・Issue作成は行っていない。各PR着手時に最新mainとの差を照合する。

## 判断と目標

大規模利用を阻む構造的問題は確認できた。全root 10万件の行生成に約78秒、深さ1万のlistOutline算法だけで約12.8秒、3,000 Works / 24,000 linksの本文1件変更にdiffだけ約146msかかる。これらは単体実測で、GUI全体の応答時間ではない。小規模を含めて製品全体が実用不能とはまだ断定しない。一方、1万件以上を汎用的に扱えるという判断は現状ではできない。

最初の到達目標は**1万Occurrenceを日常編集できること**。ノード数だけでは不足するため、本文総量・Revision数・link密度・同時可視行数も測定条件に含める。10万件は算法の破綻検出用stressとし、全件ロード・全件表示の対応保証は後段で判断する。

以下の時間目標は新たな提案であり、現状の保証ではない。

| 指標 | 初期受入目標 |
|---|---|
| 入力→次paint | p95 < 50ms。入力中に保存キューが際限なく増えない |
| 通常の単一移動・折りたたみ | 操作→表示反映 p95 < 100ms |
| Tree pan/zoom | 60Hz環境でframe budget約16.7msを目指す。world layout再構築0回 |
| 保存 | UI反映と耐久化完了を別記。失敗を隠さずdraftを保持、flushで最新入力まで確定 |
| 大量操作 | 対象m件に対してRPC・transaction・全state captureの回数がm比例で増えない |
| 深い木・循環 | stack overflow、無限ループなし。行順・Knot・reference stubの意味を保持 |

保存時間の数値目標は実SQLiteのbaseline取得後に決める。backend処理とrenderer frame時間を同じ指標にしない。

## 改修順序とPR境界

順序は **P0計測 → P1算法 → P2操作batch → P3保存 → P4更新範囲 → P5描画**。
TreeのP6はP0後に独立して進められる。各段階でbaselineと比較し、正しさ・性能を確認してから次へ進む。全体を書き直すPRにしない。

| 段階 / PR案 | 具体的な変更 | 完了条件 |
|---|---|---|
| P0: baselineと回帰試験 | seed固定fixture、実SQLiteの隔離DB、renderer/backend別計測、操作単位counterを用意 | 1千/1万件の入力・移動・collapse、dense fixture、保存失敗・再起動を再現できる |
| P1a: 小さな二乗探索除去 | rootのfind→Map、expandedのincludes→Set、注釈の行別filter→group、breadcrumbのunshift→push/reverse | 多rootでrN、注釈でVAの反復が消える。既存順序・表示結果が一致 |
| P1b: 深い木とKnot | 親鎖の重複探索を共有し、深い再帰を明示stackへ | deep 1万が秒単位の祖先反復を起こさない。10万stress完走、循環・同Work再帰配置の意味が一致 |
| P2a: Outline操作batch | 子昇格削除、全collapse、復元空ノード削除を操作単位で確定 | 対象件数によらず各操作の保存transactionは1回、Outline公開は1回。子順・失敗時復元を維持 |
| P2b: N+1除去 | Stubの全文逆参照探索を共有、候補保存をbatch、未配置空Work掃除をbatch | Stub数Sで全文parseがS回にならない。候補c/掃除uで全captureがc/u回にならない |
| P3a: 差分保存の基礎 | 無変更Knotを保存入口前で省略、feedback位置索引、listOutlineの書込を整理 | 通常readはtransaction 0回。構造変更のKnot確定は1回、保存・再起動後も一致 |
| P3b: 小更新の保存 | 本文・caret・collapsedから変更recordを直接追跡し、段階的に全capture/diffを置換 | 単件変更で無関係な全本文のclone/stringify/validationがない。DB失敗時にmemoryも整合する |
| P4: 更新伝播限定 | 操作結果の種別と影響IDを使い、必要なread modelだけ更新/失効 | collapseでGlobalLineage/bookmark取得0回。入力で構造index再構築0回。draft・世代保護が維持される |
| P5: Outline仮想化 | viewport＋overscanだけ描画、可変高さと編集行の維持 | 1万全展開でもDOM/editor数がviewportに依存。IME・focus・keyboard・drag・復帰が動く |
| P6a: Tree camera分離 | world layoutを保持、panは投影/culling、zoomは必要なLOD更新に限定 | panで世代/SCC/lane再計算0回。filter/data変更では正しく失効 |
| P6b: Tree残存算法 | ready queue、lane探索、密集bucket比較をprofile順に改善 | dense/同時刻/hub fixtureで二乗増幅を抑え、cluster・lane・選択の仕様を維持 |

P1aは低リスクなのでP0の整備中でも着手候補。P5は1万可視行を目標にする以上必要だが、保存と全体再計算を先に減らす。P6bはP6a後のprofileで対象を絞る。

## 各段階で守る仕様・改修範囲

### P0: 計測を先に固定する

既存high-density fixtureを再利用し、全root・wide・balanced・deepを追加する。warmup5回＋計測30回、中央値/p95/max、heap/GC、保存queue待ち、SQL/transaction数を記録する。異なるcaseは同時実行しない。初期化時間は別に測る。

基本条件は短本文・履歴なし、次に2KB本文、Revision増加、E=N/8Nを一軸ずつ変える。3,000 Works / 24,000 linksの既存fixtureを共通比較点として残す。初期対象端末は監査と同じRyzen 5 3500U環境、release CEFを基準とする。

既存testは監査時にJSR依存取得で実行失敗したため、まず実行環境を復旧する。単体計測成功をtest合格として扱わない。入口は監査F節の再現手順と既存desktop inspector。

根拠: [tests/support/high_density_graph_fixture.ts:15](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/tests/support/high_density_graph_fixture.ts:15)、[tests/high_density_tree_layout_test.ts:20](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/tests/high_density_tree_layout_test.ts:20)、[deno.json:59](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/deno.json:59)。

### P1: 配列とMapで直せるものを先に直す

構造の正本を増やさず、既存純粋関数の局所変更から始める。indexの最初の候補はbyId、childrenByParent、placementsByWork/Branch、annotationsByOccurrence。必要なowner内で保持し、使わない汎用索引は作らない。

KnotはOccurrenceの親関係に対する処理、同Work再帰配置は祖先上のWork重複に対する処理として区別する。各rootからの明示stackと経路上Workカウント等を検討し、循環成分・孤立/不正親・reference stubを現仕様と照合する。祖先配列を全nodeに保存するとO(Nh)になるため避ける。

可視行だけ反復化しても、Hoist、manuscript API、SCC、Revision DAGの深い再帰は残る。対象入口ごとにstack安全性を確認する。非表示/休止機能は実装済みAPIの試験とlive UIの試験を分ける。

根拠: [src/ui/outline_view_model.ts:29](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_view_model.ts:29)、[src/ui/App.svelte:1257](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:1257)、[src/services/browsing_navigation_state.ts:187](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/browsing_navigation_state.ts:187)、[src/services/occurrence_operations.ts:286](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:286)、[src/services/occurrence_operations.ts:357](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:357)。深い再帰の一覧は監査B/D節参照。

### P2: N+1は呼出し境界から直す

一度のユーザー操作で変更計画を作り、storeの一つのmutation境界で確定する。初段では全state rollbackを残してよい。これだけでもm回の全保存を1回に減らせる。既存単件APIは必要な呼出し元のために維持し、大量操作の呼出し元だけbatch入口へ移す。

削除は「子を親階層へ昇格する」現仕様を維持する。子ごとにmoveItemを呼ばず、最終親・順序・Knotを一度計算する。空Workのtrash条件も最終状態で判定する。復元空ノードの削除はflush後の空/子なし再確認と失敗時pending保持を残す。

Stubはread snapshotを一度取得し、各本文の参照parseを一度行い、Work別backlinkへgroupする。本文parserは再利用する。永続参照indexはこの段階では不要。候補保存も既存feedback/状態遷移を保持してまとめる。

Promise.all化だけではSQLite queueの全保存回数は減らない。batch内部から外側のqueue付きmutationへ再入してdeadlockさせないよう、既存mutation内の実更新と公開入口の境界を確認する。

根拠: [src/services/occurrence_operations.ts:201](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:201)、[src/ui/keyboard_workspace_controller.svelte.ts:65](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/keyboard_workspace_controller.svelte.ts:65)、[src/ui/pending_empty_item_controller.svelte.ts:60](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/pending_empty_item_controller.svelte.ts:60)、[src/services/stub_service.ts:38](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/stub_service.ts:38)、[src/services/internal_reference_service.ts:164](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/internal_reference_service.ts:164)、[src/services/emergence_persistence.ts:57](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/emergence_persistence.ts:57)、[src/services/quick_capture_service.ts:34](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/quick_capture_service.ts:34)、[src/storage/sqlite_store.ts:340](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_store.ts:340)。

### P3: 保存量を変更量へ近づける

現状はSQL差分の前に全stateを複製・検証・比較する。SQL索引追加ではこの費用は解消しない。

P3aのread副作用整理では、Knotの全writer・reader・復元/import経路を調べる。通常構造mutationで確定し、復元時に全再構築する案を基本とする。listOutlineからreplaceKnotsを消すだけでは既存永続Knotの整合が崩れる。

P3bは本文/caret/collapsedから小さく置換する。変更前recordの復元、変更後record、必要な関連recordを操作内で追跡し、一つのtransactionへ渡す。全state clone廃止と汎用store全面改造を一緒にしない。本文保存はWork/Copy、collapseはOccurrence等、実際のmutationが更新するrecordをすべて含める。

現schemaは配列positionも永続化するため、削除で後続positionが変わる問題がある。単件text/caret/collapseではschemaを変えず改善可能。大量削除のposition費用が残る場合のみ、順序表現の変更を独立PRで検討する。

信頼境界の全validationは起動・restore/importに残す。通常mutationでは入力検証と関係不変条件を満たす局所検証を設計する。検証を単純に削除して速くする案は採らない。transaction失敗、commit失敗、queued mutation失敗後の次操作、再起動を障害注入で確認する。

根拠: [src/storage/sqlite_store.ts:336](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_store.ts:336)、[src/storage/memory_state_container.ts:47](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_state_container.ts:47)、[src/storage/sqlite_records.ts:291](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:291)、[src/storage/sqlite_records.ts:318](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:318)、[src/storage/sqlite_records.ts:383](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:383)、[src/services/occurrence_operations.ts:28](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:28)。

### P4: 再読込を変更種別で分ける

既存OutlineController/TreeController/Workspaceを使う。backend保存済みデータとEditor draftの正本を変えず、描画snapshotだけ局所公開する。全reloadは起動、restore、未知の変更、整合回復のfallbackとして残す。

| 変更 | 更新/失効対象 | 原則再利用するもの |
|---|---|---|
| caret | resume保存 | Outline構造、Tree、bookmarks |
| collapsed | 該当配置と可視行 | Knot、親子index、GlobalLineage、bookmarks |
| 本文 | 同branchの配置、表示名、最近編集、本文参照/補完 | 親子index、Knot。updatedAtやlabelに依存するTree計算は影響を判定 |
| 移動/追加/削除 | 親子/兄弟、可視行、Knot、暗黙link、選択補正 | 無関係本文parse、bookmarks（参照削除等があれば失効） |
| link/履歴/年代 | 対応注釈、Tree投影、対象履歴等 | 影響のないOutline構造 |

固定の「text変更ならTree全部無効化しない」というルールだけでは不十分。依存する値を確認する。最近編集6件はまず固定top-kで全sortを避け、増分管理は必要性が残った場合に限る。

局所反映中の旧reload、保存中の追加入力、同branch複数配置、pinned revision、画面遷移中の保存を回帰試験にする。変更種別/IDは既存公開操作の結果に必要な範囲で付け、全feature共通event busを新設しない。

根拠: [src/ui/outline_controller.svelte.ts:83](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:83)、[src/ui/outline_controller.svelte.ts:132](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:132)、[src/ui/editor_working_copy.ts:3](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_working_copy.ts:3)、[src/services/recent_edited_items.ts:11](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/recent_edited_items.ts:11)。契約: [docs/design/ui-state-ownership.md:16](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/docs/design/ui-state-ownership.md:16)、[docs/design/tree-state-ownership.md:22](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/docs/design/tree-state-ownership.md:22)。reload契約の変更はこれらの文書にも反映する。

### P5/P6: 描画とジェスチャーの仕事を限定する

Outlineは可視順序配列＋viewport範囲＋高さcacheから始める。初期方式は計測後に選び、SumTree導入を前提にしない。編集行はIME/選択が継続する間unmountしない方針を検討する。画面外へのkeyboard移動はscrollとmount完了後のfocusへ接続する。dragは行のDOMだけに依存せず、全可視順序で移動先を解決する。accessibility・折りたたみ後のfocus補正を受入条件に含める。

Treeはcamera依存のscreen投影と、data/filter依存の世代・隣接・laneを分ける。zoomは画面上の距離・LODに影響するためpanと同じ無効化規則にしない。画面外除外前の全layout費用も測る。HistoricalTimelineやSparseの改修は各profileに基づき、liveのPhylogeneticTreeと一括改造しない。

根拠: [src/ui/OutlineView.svelte:115](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineView.svelte:115)、[src/ui/OutlineRowItem.svelte:89](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineRowItem.svelte:89)、[src/ui/PhylogeneticTree.svelte:82](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:82)、[src/ui/tree_layout.ts:217](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:217)、[src/ui/tree_layout.ts:293](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:293)、[src/ui/historical_timeline_layout.ts:106](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/historical_timeline_layout.ts:106)。

## リリース判定と次の規模

P3/P4完了時に保存・操作の全体費用を再測定する。P5/P6完了時にrelease WebView上の1万件受入試験を行う。劣化caseを平均に埋めず、形状/本文量/履歴/密度別に対応範囲を記録する。

10万件についてはP1の算法stress成功とGUI対応を区別する。全stateロード/通信/heapが残るなら、選択枝・必要履歴の取得とread model分割を次の計画にする。単純配列の可視順序/高さ更新が支配的になった時点でFenwick/SumTreeを比較する。

今回計画しないもの: WebView全面置換、DB再移行、汎用graph/index基盤、SumTree先行導入、全処理worker化。これらは確認済みの反復を減らした後にも残る問題に対して検討する。

未確認: 実GUIのp95、実SQLiteの保存時間、改修後の到達規模。本書の受入値は提案。  
主要リスク: batch・局所更新・clone廃止による原子性、draft、Knot、要求世代の退行。各PRの正しさ試験を省略しない。
