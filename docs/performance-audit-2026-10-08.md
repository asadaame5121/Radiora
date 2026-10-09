# Radiora アウトライン・ツリー性能監査

調査: 2026-10-08〜09  
対象: HEAD 9c8aaa7b08d0891e3d4b5248efccb849618017b8。開始時の作業ツリーはclean。  
範囲: 読取調査、既存関数のメモリ上の単体計測、改善提案。変更は本レポートのみ。実装・依存関係・DB・設定・テストファイルは変更していない。

「実測」はこの環境での単体測定、「静的確認」はコード上の走査・呼出し、「推定」はその計算量・影響。実機GUIの応答、DOM更新回数、SQLite保存時間は未測定。Big-Oとミリ秒を区別する。

## A. エグゼクティブサマリー

1. **SQLiteへの小さな保存にも全グラフの費用がかかる。** 現行既定はSQLite＋MemoryGraphStore。本文1件、caret位置、collapsed変更でも、前後の全state複製→全体検証→全レコードJSON比較を通る。SQLは差分でも、保存前処理は総データ量に依存する。3,000 Works / 24,000保存リンクのfixtureでは、差分計算だけで142〜195ms。履歴本文が増えるとNが同じでも悪化する。[src/storage/sqlite_store.ts:336](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_store.ts:336)、[src/storage/sqlite_records.ts:291](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:291)、[src/storage/memory_state_container.ts:47](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_state_container.ts:47)
2. **単一操作から全体処理を重ねる。** 折りたたみでも全Outline・Tree・bookmark再読込。移動のKnot再計算後、listOutlineで再度計算・保存する。子d件の削除は子を1件ずつmoveItemし、全件折りたたみはm件のRPCと全体保存を繰り返す。[src/ui/outline_operations_controller.svelte.ts:172](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_operations_controller.svelte.ts:172)、[src/ui/outline_controller.svelte.ts:132](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:132)、[src/services/occurrence_operations.ts:180](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:180)、[src/ui/keyboard_workspace_controller.svelte.ts:65](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/keyboard_workspace_controller.svelte.ts:65)
3. **形状によって二乗化し、深い木では再帰限界にも達する。** 可視行のroot探索はrootごとにfindし、全nodeがrootならO(N²)。10,000 rootで254〜904ms、100,000 rootで78〜83秒を再現。listOutlineの祖先走査はchainでO(N²)、10,000段で10.8〜12.9秒（保存・ストア投影を除外）。100,000段の可視行生成はRangeErrorで失敗した。[src/ui/outline_view_model.ts:29](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_view_model.ts:29)、[src/services/occurrence_operations.ts:286](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:286)、[src/services/occurrence_operations.ts:357](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:357)
4. **描画量と高頻度の再計算が限定されていない。** Outlineは折りたたみ後の全可視行にMarkdownEditorを生成し、viewport仮想化はない。入力は構造全体を必ず再計算するわけではないが、最近編集の全sort、注釈生成と各行の全注釈filterを無効化し得る。TreeはLOD/画面外除外がある一方、pan/zoomも全layoutの依存。3,000件fixtureのlayoutは309〜399ms。[src/ui/OutlineView.svelte:115](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineView.svelte:115)、[src/ui/OutlineRowItem.svelte:89](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineRowItem.svelte:89)、[src/ui/App.svelte:492](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:492)、[src/ui/PhylogeneticTree.svelte:82](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:82)
5. **N+1はSQL SELECTより上位層に存在する。** Stubごとに全文逆参照検索、関連候補ごとに全体保存、復元空ノードごとに削除＋再読込。asyncの並列化だけでは解決しない。SQLite mutationはキューで直列化され、まとめて一度に確定する境界が必要。[src/services/stub_service.ts:38](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/stub_service.ts:38)、[src/services/emergence_persistence.ts:57](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/emergence_persistence.ts:57)、[src/ui/pending_empty_item_controller.svelte.ts:60](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/pending_empty_item_controller.svelte.ts:60)、[src/storage/sqlite_store.ts:340](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_store.ts:340)

### 現設計での規模判断

| 条件 | 判断 |
|---|---|
| 1,000件前後、浅い木、短い本文、少ない履歴・リンク、表示枝限定 | 現設計を維持して測定を進められる候補域。可視行生成単体は数ms〜約20ms。ただしDB・editor・描画込みの快適性は未保証。 |
| 数千件、リンク数万件 | 既存fixtureの規模。layout約0.3〜0.4秒、diffだけ約0.14〜0.20秒で、高頻度経路として余裕がない。 |
| 10,000件 | 一律の対応宣言はできない。1root＋広い子では可視行生成が軽くても、多rootなら数百ms、chain全読込は十数秒。 |
| 100,000件 | 現設計の汎用対応規模とは見なせない。root形状で数十秒、深い木はstack overflow。Hoistだけではbackend全体処理は消えない。 |

これは製品の固定上限ではない。N、root数、深さ、同時可視行数、リンク密度、本文総量、Revision量で判断すべきである。

**今から用意すべき境界は、既存owner内の構造インデックス、変更種別と影響ID、複数変更を1回で確定する保存操作。SumTreeや汎用graph engineを先に導入する根拠はない。**

## B. 処理・計算量一覧

### 記号・現行構成

N=Occurrence、W=Work、C=WorkingCopy、R=Revision、E=link、h=親深度、r=root数、s=兄弟数、d=削除対象の直接の子数、k=部分木サイズ。V=折りたたみ後の可視行数（viewport内ではない）、X=一時展開ID数、A=展開された注釈数、q=検索hit数。B=本文/履歴を含む全保存state量、F=feedback件数。

P=listItemsの投影・複製費用で、時間/空間とも概ねO(W+C+R+N+投影本文量)。M=SQLite mutation費用で、通常O(B)の複製・検証・比較にO(F²)のfeedback比較、Revision検証、SQL差分書込が加わる。常にO(B)だけとは限らない。Map/Set参照は期待O(1)、sortは比較回数O(n log n)。文字列長・JSON・Markdown解析の費用は別途。空間欄は主に追加作業領域。

既定はsqlite、turso名は互換alias。Surreal関連ファイルは残るが既定runtimeではない。SQLiteはnode:sqlite同期adapterを利用し、通常readはMemoryGraphStoreを継承する。[src/storage/storage_bootstrap.ts:37](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/storage_bootstrap.ts:37)、[src/storage/storage_bootstrap.ts:55](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/storage_bootstrap.ts:55)、[src/storage/turso_store.ts:1](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/turso_store.ts:1)、[src/storage/sqlite_store.ts:42](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_store.ts:42)

親子はOccurrence.parentOccurrenceId/orderKey、折りたたみはcollapsed。本文はbranch working copyまたはpinned revisionから解決。意味linkはWork/Revision endpointを持つ。SQLはid/position/JSON payloadを保存し、id主キーとposition索引を持つ。親ID・endpoint専用索引、再帰CTEは通常read経路にない。通常検索もメモリを走査する。**SQL索引だけを追加してもメモリfilterは高速化しない。** [src/storage/sqlite_schema.ts:23](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_schema.ts:23)、[src/storage/memory_store_operations.ts:225](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store_operations.ts:225)、[src/storage/memory_store.ts:463](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store.ts:463)

### Outline・編集・参照

| 処理 | 実装 | 時間 / 追加空間・問題 |
|---|---|---|
| listItems | [src/storage/memory_store.ts:103](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store.ts:103)、[src/storage/memory_store_operations.ts:225](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store_operations.ts:225) | P / P相当。Work/Copy/Revision Mapを毎回作り、全Occurrence投影後clone。SQLの1件ずつjoinではない。 |
| ノード/配置追加 | [src/services/occurrence_operations.ts:49](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:49)、[src/services/occurrence_operations.ts:82](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:82)、[src/services/occurrence_operations.ts:343](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:343) | O(P+s log s)+M / O(P+s)+保存領域。全filter→兄弟sort→findIndex。配置元fallbackは追加read。orderKeyは中間値で、全兄弟キーを書き直さない。 |
| 移動・並べ替え | [src/services/occurrence_operations.ts:180](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:180) | O(P+N+s log s+Nh)+2M / O(P+N+h)+保存領域。更新Occurrenceは1件だが全Knot再計算・保存。UI reloadは追加。 |
| 削除（子を親階層へ昇格） | [src/services/occurrence_operations.ts:201](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:201) | O(P+s log s+d log d+Σ子ごとの移動費用+Nh)+追加M / 逐次なので主にO(P+N+h)+保存領域。d≈Nなら浅い木でも反復が増幅。部分木一括削除ではない。 |
| 本文保存 | [src/services/occurrence_operations.ts:115](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:115)、[src/storage/memory_store.ts:313](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store.ts:313) | O(P+W+C)+M / O(P+W+C)+保存領域。requireItemが全listItems後find。Copy/Work更新もmap。 |
| 1件collapse/expand | [src/services/occurrence_operations.ts:127](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:127)、[src/ui/outline_operations_controller.svelte.ts:172](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_operations_controller.svelte.ts:172) | backend O(P+N)+M＋全reload / O(P+N)+保存領域。DOM削減の利点と全再計算の問題を分ける。 |
| 全件collapse/expand | [src/ui/keyboard_workspace_controller.svelte.ts:65](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/keyboard_workspace_controller.svelte.ts:65) | m対象でO(m(P+N+M))＋reload / 各呼出し作業領域。m=Nなら二乗級。 |
| listOutline | [src/services/occurrence_operations.ts:28](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:28) | 非循環O(P+Nh+E)+M / O(P+N+E+h)+保存領域。readにもreplaceKnots保存がある。 |
| Knot検出 | [src/services/occurrence_operations.ts:357](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:357) | 非循環O(Nh)、chain O(N²)、全N cycleでO(N² log N)上界 / O(N+h)。各startで親鎖再探索、cycle sortはsignature重複判定前。 |
| 同Work再帰配置検出 | [src/services/occurrence_operations.ts:286](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:286) | O(Nh) / O(N+h)。byIdはあるが祖先結果を共有しない。visitedで循環停止。 |
| 親ID取得 | [src/ui/App.svelte:453](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:453) | Map構築O(N)、以後期待O(1) / O(N)。本文変更だけでMapが毎回再構築されるとは限らない。 |
| 子・兄弟取得 | [src/ui/outline_operations_controller.svelte.ts:117](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_operations_controller.svelte.ts:117) | O(N+s log s) / O(s)。filter/sortを反復。 |
| 祖先breadcrumb | [src/services/browsing_navigation_state.ts:187](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/browsing_navigation_state.ts:187) | O(N+h²) / O(N+h)。Map＋親鎖に加えunshift反復がある。 |
| Hoist子孫取得 | [src/services/browsing_navigation_state.ts:156](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/browsing_navigation_state.ts:156) | O(N+k+h²) / O(N+k+h)。children Map→再帰→全filter→breadcrumb。visited有り、深さ制限なし。 |
| 可視行生成 | [src/ui/outline_view_model.ts:11](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_view_model.ts:11) | O(N+Σ兄弟sort+rN+VX)、上界O(N log N+rN+VX) / O(N+V+h)。rootごとfind、展開ID includes。非表示のvisitは省くがMap/sortは全投影対象。 |
| ID→行/DOM位置 | [src/ui/App.svelte:1212](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:1212)、[src/ui/App.svelte:400](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:400)、[src/ui/keyboard_controller.svelte.ts:120](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/keyboard_controller.svelte.ts:120) | 行find O(V)。DOM selectorはbrowser依存。Tree focusは描画node配列O(D)時間/空間。pixel/rank索引はない。selectorをO(1)と断定しない。 |
| ローカル本文反映 | [src/ui/editor_controller.svelte.ts:70](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_controller.svelte.ts:70)、[src/ui/editor_working_copy.ts:3](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_working_copy.ts:3) | O(N) / 走査自体O(1)。ID findと同branch配置の全件走査。draft文字列等は別。 |
| 最近編集6件 | [src/services/recent_edited_items.ts:11](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/recent_edited_items.ts:11) | O(N log N) / O(N)。全sort→Work重複除外→最後にslice(6)。 |
| 暗黙親子link | [src/services/implicit_relation.ts:21](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/implicit_relation.ts:21) | O(N+E) / O(N+E)。Set/Mapは妥当。OutlineとGlobalLineageで同じ元dataから別計算。 |
| link注釈 | [src/services/semantic_link_annotations.ts:38](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/semantic_link_annotations.ts:38)、[src/ui/App.svelte:1257](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:1257) | 生成O(N log N+E+A log A+名前抽出)、全表示行の抽出O(VA) / O(N+A)＋行配列。Workの複数配置でAはEより増える。 |
| 逆参照・補完 | [src/services/internal_reference_service.ts:164](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/internal_reference_service.ts:164)、[src/services/internal_reference_service.ts:246](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/internal_reference_service.ts:246) | 全Copy/Revision読込＋全文解析＋結果sort。補完タイトルはWorkごとのbranch/copy filter / 全読込量＋結果。parserの厳密な最悪計算量は未証明。 |

### 派生ビュー・layout・保存

| 処理/表示 | 実装・条件 | 計算量と限界 |
|---|---|---|
| GlobalLineage | 実装済み。[src/services/branch_service.ts:164](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/branch_service.ts:164) | 全Works/items/links/revisions/branches取得、代表Occurrence sort、暗黙link/filter。概ねO(P+E+W+R+branch sort+N log N)。Work代表のgraphでありOutline配置木と同一ではない。空間は取得量相当。 |
| Chronology/Lineage | 実装済み。[src/ui/tree_layout.ts:92](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:92)、[src/ui/tree_layout.ts:217](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:217) | sort O(N log N)、lane探索O(NL)、Lはlane数で密な同時刻ならNまで増える。通常空間O(N+E)。snapshot/projection/size/camera変更で再計算。 |
| Lineage世代・循環 | [src/ui/tree_lineage_projection.ts:15](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_lineage_projection.ts:15)、[src/ui/tree_lineage_cycles.ts:26](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_lineage_cycles.ts:26) | SCC＋隣接sort。世代はready.shift、追加ごとのready.sortで、O(N+E)ではない。一般上界O(N² log N+隣接sort+E)。空間O(N+E+h)。 |
| lane順graph走査 | [src/ui/tree_lane_order.ts:10](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_lane_order.ts:10)、[src/ui/tree_lane_order.ts:62](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_lane_order.ts:62) | DFS visited有り。neighborごとのoutline.includesが高次数で二乗項。component比較器内でもmember sort。空間O(N+E)、再帰stackも使う。 |
| LOD/cluster | [src/ui/tree_layout.ts:293](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:293) | 空間bucket内のpair比較。極端な縮小で集中するとO(N²)時間、隣接SetもO(N²)空間。出力1clusterでも前処理は軽くならない。 |
| 年表 | 実装済み。[src/ui/HistoricalTimeline.svelte:19](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/HistoricalTimeline.svelte:19)、[src/ui/historical_timeline_layout.ts:106](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/historical_timeline_layout.ts:106) | sort＋laneEnds.findIndex、最大O(N²+E)、空間O(N+E)。cameraはscreenScaleへ作用しlayoutは毎pan必須ではない。全nodes/edgesをSVG生成。 |
| WorkLineage | 実装済み。[src/services/branch_service.ts:233](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/branch_service.ts:233)、[src/ui/WorkLineage.svelte:17](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/WorkLineage.svelte:17) | 全配列workId filter、対象Revision/Branch sort。UIはhead Mapと対象履歴全列挙。時間O(W+全Branch+R+対象sort)、空間取得結果相当。 |
| Sparse Outline | 実装済み。[src/services/sparse_outline.ts:18](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/sparse_outline.ts:18)、[src/ui/SparseOutlineView.svelte:25](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/SparseOutlineView.svelte:25) | O(N+qh+qE+K log K)、K=含めたnode数。hitごと全link。空間O(N+K+breadcrumb)。UIはchildren/depth/visibleOrder派生、collapsedでvisibleOrder更新。viewport仮想化なし。 |
| 部分木原稿投影 | API/service実装済み。[src/services/manuscript_projection.ts:27](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/manuscript_projection.ts:27) | O(P+N log N+k+部分木本文量)、空間O(P+N+k+本文量)。collapsed無視、visited付き再帰。専用ManuscriptViewは現行UIから除去済み。[tests/manuscript_view_contract_test.ts:3](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/tests/manuscript_view_contract_test.ts:3) |
| LongFormEditor | 現行単一項目編集。[src/ui/long_form_controller.svelte.ts:22](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/long_form_controller.svelte.ts:22) | 入力はfeature draft。部分木連結原稿ではない。保存時全reload。editor内部の本文長に対する描画費用は未測定。 |
| 起動DB読込 | [src/storage/sqlite_records.ts:240](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:240) | 固定数のrecord tableをSELECT全件→parse/validate→全state保持。O(B)以上、常駐O(B)。N件にN本SELECTではない。 |
| SQLite mutation | [src/storage/sqlite_store.ts:336](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_store.ts:336)、[src/storage/sqlite_records.ts:383](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:383) | 前後capture、全validation、JSON diff。position変化もupsert対象なので配列先頭削除は後続多数行を書き得る。 |
| feedback差分 | [src/storage/sqlite_records.ts:318](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:318) | feedbackごとObject.keys(before).indexOfでO(F²)。全mutationから呼ばれる。一時空間O(F)、累積allocation増。 |
| Revision DAG検証 | [src/storage/graph_state_validation.ts:430](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/graph_state_validation.ts:430) | completeで重複を抑えるが再帰ごとpath Set複製。深い未訪問chainを先頭からたどる入力順ならO(R²)時間/live path領域、stack限界。親先行順はこの最悪条件とは異なる。 |
| JSON backend | [src/storage/json_persistence.ts:49](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/json_persistence.ts:49) | backup全state serialize/write、O(B)以上の時間/領域。既定ではない。 |
| startup cache | [src/ui/startup_controller.svelte.ts:61](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/startup_controller.svelte.ts:61)、[src/desktop/startup_snapshot_cache_file.ts:25](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/desktop/startup_snapshot_cache_file.ts:25) | 全snapshot RPC→検証→JSON保存、時間/領域O(snapshot bytes)。保存成功・reloadで発生。差分cacheではない。 |

### キャッシュ、循環、深さ

OutlineControllerはsnapshotを保持するが、overlayDraftsは全itemsを新object化する。reloadは広いidentity更新。読込中編集の再適用は編集数aに対し最大O(aN)。[src/ui/outline_draft_overlay.ts:5](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_draft_overlay.ts:5)、[src/ui/outline_controller.svelte.ts:83](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:83)

TreeControllerのfilter key/世代は、同keyの不要なvisible refreshや旧結果公開を抑える。prepareRefresh自体は同keyでもreadを開始し、Outline reloadも呼ぶ。keyはfilter/選択Workで、変更種別/影響IDの局所無効化ではない。要求失効はbackend中断と同義ではない。[src/ui/tree_controller.svelte.ts:101](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_controller.svelte.ts:101)、[src/ui/tree_controller.svelte.ts:113](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_controller.svelte.ts:113)、[src/ui/App.svelte:847](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:847)

Knot/再帰配置はloop＋Set。Hoist/原稿/Sparse/lane/Tarjanはvisited等で循環を扱うが、深い非循環木のJS stackは保証しない。buildVisibleRows自体にはvisitedがなく、通常はKnot stash/referenceStub処理済み入力に依存する。[src/ui/outline_view_model.ts:17](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_view_model.ts:17)、[src/services/browsing_navigation_state.ts:171](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/browsing_navigation_state.ts:171)、[src/services/manuscript_projection.ts:44](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/manuscript_projection.ts:44)

Math.min/maxへの大量spreadも引数上限リスクがある。ただし今回の再現例外はbuildVisibleRowsの再帰であり、spread失敗は実測していない。[src/ui/PhylogeneticTree.svelte:61](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:61)、[src/ui/tree_layout.ts:299](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:299)

## C. 更新伝播の分析

### 1. Outlineで1文字入力

~~~text
OutlineRowItem / MarkdownEditor
  → editorController.updateLocalText
  → snapshot.items.find
  → OutlineController.updateText
  → applyBranchWorkingCopyText（同branch配置を全件から探索しtext/updatedAt更新）
  ├─ 本文/日時を読むderived・Markdown表示
  ├─ WorkingCopy autosave（250ms debounce）
  ├─ caret/resume autosave（別の250ms debounce）
  └─ completion trigger判定 → 成立時に補完RPC
~~~

[src/ui/OutlineRowItem.svelte:89](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineRowItem.svelte:89)、[src/ui/editor_controller.svelte.ts:70](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_controller.svelte.ts:70)、[src/ui/outline_controller.svelte.ts:112](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:112)。タイマは[src/services/working_copy_autosave.ts:65](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/working_copy_autosave.ts:65)、[src/services/resume_position_autosave.ts:32](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/resume_position_autosave.ts:32)。

- **構造全体が毎文字再計算されるとは断定しない。** itemByIdはid、browsingProjection/visibleRowsは主にparentId/orderKey/collapsedを読む。text変更だけではそれらの依存を直接変えない。Svelte derivedは同期的に読んだ依存で無効化し、必要時に再評価する。[src/ui/App.svelte:453](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:453)、[src/ui/App.svelte:471](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:471)、[src/ui/App.svelte:533](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:533)。[Svelte derived公式説明](https://svelte.dev/docs/svelte/$derived)
- updatedAtを比較するrecentEditedItems、textを使うlinkableWorks/注釈代表名は影響を受ける。各OutlineRowのannotations derivedは全注釈filterを呼ぶ。代表Workの本文変更等で注釈配列が再生成されると、O(VA)の抽出が再発し得る。厳密な回数はtrace未計測。[src/ui/App.svelte:492](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:492)、[src/ui/App.svelte:521](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:521)、[src/ui/OutlineRowItem.svelte:46](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineRowItem.svelte:46)、[src/ui/App.svelte:1257](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:1257)
- 編集行/同branchの別配置でMarkdown解析・プレビューが更新され得る。MarkdownEditorは同valueならsetValueしない。keyed eachもあり、毎文字全editorを作り直すコードではない。[src/ui/MarkdownEditor.svelte:76](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/MarkdownEditor.svelte:76)、[src/ui/OutlineView.svelte:115](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineView.svelte:115)
- $stateの配列/objectは深いリアクティビティを持つ。大きなsnapshotを全走査するderivedは多数のproperty読取・依存追跡を伴う。proxy overhead倍率/heapは未測定。一律$state.raw化は既存in-place本文更新の契約を変えるため推奨しない。[src/ui/outline_controller.svelte.ts:34](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:34)。[Svelte state公式説明](https://svelte.dev/docs/svelte/$state)
- 入力停止後は通常、本文保存1RPC＋caret保存1RPC。前者は全listItems、後者は全listOccurrencesから対象を探し、それぞれMを払う。保存済みでdraftなしならstartup cacheの全送信RPCも起きる。**1文字=1保存ではなく、停止/flush/保存中追加入力に依存する。** [src/services/navigation_service.ts:44](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/navigation_service.ts:44)、[src/ui/editor_controller.svelte.ts:54](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_controller.svelte.ts:54)、[src/services/working_copy_autosave.ts:164](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/working_copy_autosave.ts:164)
- 補完はtrigger成立時。internal reference入口にdebounceはなく、inline linkは同trigger判定を持つ。onChangeとinput/keyup等のselection通知の両方があるが、毎回二重RPCとは言えない。世代判定は公開を抑えるだけで開始済み検索費用は残る。[src/ui/editor_completion_controller.svelte.ts:64](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_completion_controller.svelte.ts:64)、[src/ui/editor_completion_controller.svelte.ts:95](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/editor_completion_controller.svelte.ts:95)、[src/ui/overtype_markdown_editor_adapter.ts:174](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/overtype_markdown_editor_adapter.ts:174)

LongFormの毎文字入力はfeature draftだけで、保存時にupdateItemText＋reloadへ合流する。この経路を部分木原稿全体の編集と混同しない。[src/ui/long_form_controller.svelte.ts:28](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/long_form_controller.svelte.ts:28)、[src/ui/long_form_controller.svelte.ts:51](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/long_form_controller.svelte.ts:51)

### 2. 1ノード移動

~~~text
drag.dropOn / indent / outdent / moveSibling
  → RPC moveItem
  → listItems → siblings sort → updateOccurrence [mutation 1]
  → reconcileKnots → listItems → detectKnots → replaceKnots [mutation 2]
  → OutlineController.reload
      ├─ listOutline → listItems → detectKnots → replaceKnots [mutation 3]
      │                 → markRecursivePlacements → implicit links
      ├─ listGlobalLineage → items/works/revisions/branches/links → projection
      └─ listBookmarks
  → draft overlay → snapshot publish
  → visibleRows / DOM更新、必要ならTree layout
  → startup cache保存、focus復帰
~~~

[src/ui/outline_drag_controller.svelte.ts:21](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_drag_controller.svelte.ts:21)、[src/services/occurrence_operations.ts:180](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:180)、[src/ui/outline_controller.svelte.ts:117](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_controller.svelte.ts:117)、[src/ui/App.svelte:145](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:145)

通常成功経路は変更1RPC＋reloadの3RPC＋cache条件付き1RPC。focus後の選択によるhistory/backlinks/emergence取得は別。mutation3回は**全体前処理回数**であり、Knotが同じならSQL diffが空でtransactionは省略する。しかしclone/validation/diffは既に実行済み。[src/storage/sqlite_records.ts:388](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:388)

部分木kの子孫レコードをk個更新する必要はない設計。この利点を保ち、変化しない全体情報の再計算を減らすのが先。

### 3. 1ノード折りたたみ

toggle → 一時展開ID除去 → setCollapsed RPC → requireItem全投影 → updateOccurrence → reload（Outline/Tree/bookmark）→可視行生成。通常mutation前処理2回（collapsed、listOutlineのreplaceKnots）。暗黙linkやKnotが変わらない操作でも同じ経路を使う。[src/ui/outline_operations_controller.svelte.ts:172](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/outline_operations_controller.svelte.ts:172)、[src/services/occurrence_operations.ts:127](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:127)

一時展開除去と後のsnapshot交換でvisibleRowsが別々に無効化され得る。awaitを挟むので必ず同batchの1回とは限らない。回数は未実測。

### 4. Tree表示・pan/zoom・選択

GlobalLineageは別read model。表示中effectはview/filter/選択Workを追跡し、key不一致でrefresh。pan/zoomはRPCを直接起こさないがcamera→layout依存で全JS計算を起こす。Lineage世代はViewの軸用とcalculateTreeLayout内で重複する。[src/ui/App.svelte:847](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:847)、[src/ui/PhylogeneticTree.svelte:71](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:71)、[src/ui/tree_layout.ts:106](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_layout.ts:106)

Tree選択は表示例外のfilter keyを変え得る。App selection effectはhistory、WorkLineage、recovery、backlinks、emergenceを取得する。textそのものの変更が直接依存ではなく、入力毎に必ず全RPCとは言えない。[src/ui/tree_controller.svelte.ts:92](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/tree_controller.svelte.ts:92)、[src/ui/App.svelte:653](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:653)、[src/ui/App.svelte:663](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/App.svelte:663)

## D. ボトルネック候補

### 重大度

優先度は障害報告の件数ではなく、再現性・影響範囲・頻度で評価した。

| 優先度 | 条件・候補 | 根拠/影響 |
|---|---|---|
| 高 | 小変更への全体保存前処理 | Mが本文/caret/collapsed/Knot/提案へ反復。diff単体遅延を実測。履歴蓄積でも悪化。 |
| 高 | 多root/深い木 | O(rN)/O(Nh)。10万root約80秒、10万段stack超過、1万段全Outline約12秒を再現。 |
| 高 | 子多数削除・全件collapse | d/m回の全read・保存。操作全体の時間は未実測だが呼出し構造確定。 |
| 高 | 全可視editorと注釈filter | V個editorとO(VA)。初回表示/展開、注釈代表名変更で顕在化候補。DOM/heap未測定。 |
| 高 | Tree gesture全layout | camera依存、lane/密集pair。3千件で0.3秒級を再現。1,500msテストは60Hzの16.7msとは異なる予算。 |
| 中〜高 | Stub逆参照N+1・候補保存 | 本文量/Stub数/候補数で増幅。詳細は下表。 |
| 中 | feedback F²/深いRevision検証 | N以外の蓄積が全保存へ影響。今回fixtureでは最悪条件未測定。 |
| 中 | snapshot再公開/cache全送信 | object再生成、JSON通信、allocation。O(N)自体ではなく頻度が問題。 |

各根拠のファイル/行はA・B・Cおよび次表に対応する。

### N+1の追加監査

ast-grepでfor/while内のawait_expression、およびmap/forEach/flatMap callback内のstore/api呼出しを抽出し、呼出し先まで確認した。polling/retry、fixtureのloopは指摘から除外。以下は静的算定で、RPC/SQLトレースの実測本数ではない。

| 経路 | 種別・回数 | 評価・最小改善 |
|---|---|---|
| 通常listItems/GlobalLineage | 固定数の全件メモリread。起動は固定テーブル数SELECT | **SQL SELECT N+1は確認されない。** 全readの重複はある。共通投影の再利用が先。[src/storage/memory_store_operations.ts:225](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store_operations.ts:225)、[src/storage/sqlite_records.ts:259](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:259) |
| 子d件のOccurrence削除 | 外側listItems 1＋各moveItem 2d＋末尾reconcile 1、主要部で2d+2回。mutationも2d+2回、blank Work trashは条件付き追加 | **service内N+1型**。外側RPCはdeleteItem 1本、UI reloadは別。子の再配置をbatchし、Knot/保存は最後に1回。[src/services/occurrence_operations.ts:201](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/occurrence_operations.ts:201) |
| 全collapse m件 | m本逐次setCollapsed RPC＋固定reload | **RPC N+1型**とm回M。bulk API/transactionが必要。Promise.allだけにしない。[src/ui/keyboard_workspace_controller.svelte.ts:65](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/keyboard_workspace_controller.svelte.ts:65) |
| Stub S件 | 初期3read＋各listBacklinks 4read、計3+4S。毎回全Copy/Revision解析 | **service read N+1型**で概ねS×全本文解析。S本SQL/RPCではない。1回の参照走査でtarget→backlinksを構築。[src/services/stub_service.ts:38](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/stub_service.ts:38)、[src/services/internal_reference_service.ts:164](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/internal_reference_service.ts:164) |
| 関連提案c候補 | 初期listEmergenceSuggestions 1、候補ごとstatus照会（既存なしなら最大2）＋upsert c回 | feedback lookupはO(1)。問題はc回M。返却limit=10はmaterialize後、選択で呼ばれる。変更候補のbulk保存が先。[src/services/emergence_persistence.ts:57](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/emergence_persistence.ts:57)、[src/storage/memory_store.ts:498](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/memory_store.ts:498)、[src/services/discovery_emergence_operations.ts:39](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/discovery_emergence_operations.ts:39) |
| 復元pending空node p件 | discardRestored→各deleteItem＋reload | p回の削除＋全Outline/Tree/bookmark。pが小さければ低優先。まとめて削除して最後にreload、draft/失敗保護維持。[src/ui/pending_empty_item_controller.svelte.ts:60](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/pending_empty_item_controller.svelte.ts:60) |
| 古い空の未配置Work u件 | Promise.all(trashWork) | u回SQLite mutationはqueueで直列、全diff回数は減らない。読取時清掃のbatch境界。関連経路として記録。[src/services/quick_capture_service.ts:68](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/quick_capture_service.ts:68) |
| alias展開t語 | base検索後expansions.map(searchLexical) | t追加全件走査。nodeごとのN+1ではない。展開数/頻度を測り1走査化を判断。[src/services/search_operations.ts:102](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/services/search_operations.ts:102) |

1transaction内の変更recordごとのINSERTは「N+1 SELECT」とは呼ばない。ただしposition比較や繰り返しmutationで書込数は膨らみ得る。**RPC、store read、全state capture、SQL statement、transactionを別々に測る。**

再調査用のast-grep規則（production結果だけを読取確認する）:

~~~yaml
id: awaited-call-in-loop
language: TypeScript
rule:
  kind: await_expression
  inside:
    any:
      - kind: for_in_statement
      - kind: for_statement
      - kind: while_statement
    stopBy: end
~~~

上記をPowerShell here-stringの$auditRuleへ置き、ast-grep scan --inline-rules $auditRule --json=compact src/services src/storage src/ui src/desktop を実行。awaitのないcallback内呼出しも別に調べた。構文一致だけでN+1と判定せず、同期メモリreadかSQLかまで追跡する。

### WebView・描画との切り分け

既定backendはCEF、webview buildもある。CLI実測はCEF rendererそのものではない。[deno.json:17](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/deno.json:17)、[deno.json:51](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/deno.json:51)

- Outlineはフラットrowsの描画で、データ深度そのままの再帰DOMではない。深い木の問題はJS再帰/indent。全V行のeditor、注釈、previewでDOM/イベント管理が増える。[src/ui/OutlineView.svelte:115](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineView.svelte:115)、[src/ui/OutlineRowItem.svelte:89](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/OutlineRowItem.svelte:89)
- Treeは画面外nodeのSVG実体生成を抑え、edge可視判定とLODを持つ。しかし全layout.nodesをeachで処理し、全計算までviewport規模にはならない。[src/ui/PhylogeneticTree.svelte:329](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:329)
- 年表は通常SVGをvisibility:hiddenにして追加表示し、通常SVGをDOMから除去しない。年表自身も全nodes/edgesを列挙。[src/ui/PhylogeneticTree.svelte:309](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:309)、[src/ui/PhylogeneticTree.svelte:396](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/PhylogeneticTree.svelte:396)、[src/ui/HistoricalTimeline.svelte:55](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/HistoricalTimeline.svelte:55)
- 可変長本文/注釈/SVG pathのlayout・paint負荷は潜在的。forced layoutやGPUは未計測。adapterはautoResize:falseで、根拠なく「全textareaのscrollHeightを毎入力読む」とは指摘しない。[src/ui/overtype_markdown_editor_adapter.ts:41](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/overtype_markdown_editor_adapter.ts:41)
- derived/layout/JSON stringifyはfrontend同期仕事。同期SQLiteと全state diffはDeno backendの仕事で、直接同じUI threadとは呼ばない。await待ち、JSON通信、CPU/メモリ競合で応答へ影響する。[src/ui/rpc_adapter.ts:7](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/ui/rpc_adapter.ts:7)、[src/storage/sqlite_records.ts:74](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/src/storage/sqlite_records.ts:74)
- WebView置換よりJS反復削減・保存batch・描画範囲限定が先。engine/IPC/GPU差は同じrelease build、data、操作で比較して判断する。

## E. 改善案

### 次の改善作業で優先するもの

本監査では実装しない。実装する場合も既存のstate ownership/エラー保護を維持する。

1. **小さな反復を除く:** root探索をMap、一時展開をSet、注釈をoccurrenceIdでgroup化、祖先配列をpush後reverse。最近編集6件は全sortを避ける固定top-kまたは変更Workだけの管理を比較する。既存純粋関数と直接testの範囲で行い、汎用index frameworkは作らない。
2. **変更種別で再読込を限定:** collapsedだけならKnot/GlobalLineage構造は変わらない。本文はbranch配置・表示名・参照等、構造は親子index・Knot等へ失効を分ける。本文から導出する参照を漏らさない。snapshot/draft/backendの正本と要求世代を維持。[docs/design/ui-state-ownership.md:16](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/docs/design/ui-state-ownership.md:16)、[docs/design/tree-state-ownership.md:11](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/docs/design/tree-state-ownership.md:11)
3. **操作単位のbatch:** 子の昇格削除、全collapse、提案保存を1回の検証/transactionへ。全state rollbackを最初は残しても、m回Mを1回にできる。awaitを外す、validationを削る、Promise.allだけの案は不可。
4. **保存対象の追跡:** 無変更Knotを保存入口前で省略、feedback位置参照をMap化。その後affected recordでdiff対象限定を検討。復元時の全体validation、DB整合性、障害rollbackを残す。全clone廃止は障害注入testを伴う別変更。
5. **Tree world layoutとcamera投影を分離:** pure panではadjacency/世代/順序/labelを再利用。zoomのfootprint/LODだけ更新。lane順、cluster ID、選択、Knot仕様を維持し、ready sort/lane検索/bucket pairを個別profile。

Outline viewport仮想化は1万可視行を目標にするなら優先度が高い。ただしIME、focus/caret、keyboard、drag、accessibility、可変高さが設計条件。小規模利用のみなら、上記の安価な改善と実機測定から進める。

### 候補比較

以下は導入時の設計見積りで、現実装の保証ではない。

| 候補 | 解決する問題・検索 | 更新/空間 | 複雑度・妥当性 |
|---|---|---|---|
| 配列＋Map/Set | ID期待O(1)、group/重複排除 | rebuild O(N+E)、空間O(N+E)、配列insert/delete O(N) | 低。既存実装を再利用し今すぐ候補。 |
| 隣接リスト/限定index | 子O(d)、親O(1)、部分木O(k)、Work→配置/link | 兄弟配列更新O(s)、登録期待O(1)、空間O(N+E) | 低〜中。構造変更でのみ失効。全祖先path常駐O(Nh)は避ける。 |
| 静的Euler Tour | 部分木区間、祖先判定O(1)、列挙O(k) | build O(N)、素朴な移動/insertはO(N)再番号、空間O(N) | 中。安定構造への大量query時。頻繁な移動対策単独として不十分。 |
| Fenwick Tree | 行高さprefix/位置探索O(log V) | 高さ更新O(log V)、順序insert/moveは通常O(V)再構成、空間O(V) | 中。可変高さ仮想scrollが必要になった時。graph/保存には効かない。 |
| Segment Tree | 範囲集計O(log V)、適切なlazy属性で範囲切替 | build O(V)、更新O(log V)、空間O(V)。動的insert/入れ子collapseは別設計 | 中〜高。範囲集計の必要性を実測後。 |
| SumTree | 集約sequenceのrank/height seek O(log N)、split/joinで範囲移動 | item更新O(log N)、k件新規生成は最低O(k)、構造操作は設計次第、空間O(N) | 高。10万級の動的可変高さで単純構造が限界となってから。DOM/意味graph/全保存は別問題。 |
| 仮想scroll | DOM/editorをviewport U＋overscanへ | render O(U)、高さcache O(V)。毎回visibleRowsを全構築すればCPUは全件依存 | 中。Outline大規模表示に有効。Treeの既存LOD/cullingと区別。 |
| Incremental View Maintenance | 変更IDと依存先だけ更新 | 通常O(影響範囲)、全体影響ならO(N+E)。依存indexの空間が必要 | 高。まず本文/構造/表示条件revisionと小さなdirty ID集合。汎用基盤不要。 |
| メモ化/局所無効化 | 同構造/filterのindex/世代/layout再利用 | hit O(1)、missは元の構築費、保持cacheと失効管理 | 低〜中。Tree world layout、children、参照parseから。snapshot全JSONをkeyにしない。 |

Kosshiは可視範囲、高さ/行数集約、範囲操作を考える参考になるが、Radioraの保存経路やWork/Occurrence/Revision、browser editorを解決する証拠ではない。[Kosshiの記事](https://kosshi.app/ja/why-fast)

ZedのSumTree/Ropeは集約sequenceの事例。意味link graphと表示順/高さsequenceを分け、導入時もdomain model全体を置換する必要はない。[Zed「Rope & SumTree」](https://zed.dev/blog/zed-decoded-rope-sumtree)

**現時点で不要:** WebView全面置換、別DBへ再移行、汎用dynamic tree、SumTree先行導入、全graphをworkerへ丸投げ。まず反復を減らし、残った重い純粋計算だけworker化を判断する。

## F. 性能テスト計画と今回の実測

### 環境・制限

- Windows 10.0.26200、AMD Ryzen 5 3500U、論理CPU 8、OS認識メモリ約13.91GiB。
- Deno 2.9.7 / V8 15.0.245.2-rusty / x86_64-pc-windows-msvc。
- CEF/release UIではない。各case 3回、専用warmupなし。中央値と範囲を報告。GC制御/CPU固定/他process排除なし。roots長時間測定とlistOutline測定には実行期間の重複があり、精密比較には使わない。
- deno evalから既存関数をimportし、メモリ上のfixtureを渡した。計測file、DB接続、実装変更なし。
- 既存Deno testはJSRの@std/assert manifest取得で失敗。cached-onlyでも未取得cacheを確認。依存追加せず既存fixture直接利用の単体測定へ切替。**テスト合格とは扱わない。**

### 実測1: buildVisibleRows（DOMなし）

全件異なるWork、短本文、orderKey=i、全展開、links/knots/stash/一時展開なし。fixtureとprojection生成時間を除外。rootsは全件parent=null、wideはroot1件＋残り直接子、deepはchain。

| 形状 | N | 中央値ms | 3回の範囲ms |
|---|---:|---:|---:|
| roots | 1,000 | 11.70 | 10.57〜19.40 |
| roots | 10,000 | 395.50 | 253.99〜903.73 |
| roots | 100,000 | 78,295.64 | 78,264.77〜83,438.16 |
| wide（別evalで再確認） | 1,000 | 2.25 | 0.68〜2.74 |
| wide（別evalで再確認） | 10,000 | 6.69 | 5.16〜7.56 |
| wide（別evalで再確認） | 100,000 | 44.81 | 42.34〜50.73 |
| deep（別evalで再確認） | 1,000 | 0.79 | 0.76〜0.92 |
| deep（別evalで再確認） | 10,000 | 8.07 | 6.96〜14.06 |
| deep（2回のevalで再現） | 100,000 | 完了せず | RangeError: Maximum call stack size exceeded |

比率だけでBig-Oを証明せず、r回findのコードを根拠とする。wideの44.81msも10万editor生成を含まないので、10万行表示可能の根拠ではない。

### 実測2: listOutlineの算法部分（保存・投影なし）

OccurrenceOperationsに配列をそのまま返すlistItems、何もしないreplaceKnots、空listLinksを一時portとして渡した。detectKnots/markRecursivePlacements/暗黙link生成を測る。store clone、SQLite、RPCを除外する。

| 形状 | N | 中央値ms | 範囲ms |
|---|---:|---:|---:|
| wide | 1,000 | 6.12 | 5.56〜12.91 |
| wide | 10,000 | 38.35 | 32.90〜52.91 |
| deep | 1,000 | 91.08 | 79.55〜124.57 |
| deep | 10,000 | 12,782.49 | 10,778.52〜12,854.76 |

10万deepのlistOutlineは未実行。1万で約12秒かかる算法を更に増やすより、現状の根拠で改善判断ができる。二乗からの外挿を実測秒数として載せない。

### 実測3: 既存high-density fixture

3,000 Works / 24,000保存links。GlobalLineage投影後は24,549 links（暗黙link追加）。fixture構築/GlobalLineage service取得は計測外。width=1400、height=800、camera k=.5、projectX=t/1000。Lineageにも同じ投影関数を渡した純粋関数試験で、UIのscaleとは同一でない。

| 対象 | 中央値ms | 範囲ms | 備考 |
|---|---:|---:|---|
| Chronology calculateTreeLayout | 326.75 | 309.05〜398.78 | 出力node=1 cluster |
| Lineage calculateTreeLayout | 381.03 | 323.61〜394.96 | 出力node=1 cluster |
| buildSparseOutline | 190.89 | 179.39〜194.43 | 500 hit、24,000 links |
| calculateSqliteDiff | 145.89 | 142.12〜195.04 | WorkingCopy本文1件変更、upsert=1をassert |

最後は**SQLite保存時間ではない**。前後state生成・validation・SQL・disk I/Oを除外したdiff単体。layoutは出力1clusterでも全data費用を先に払う。

既存testはlayout <1,500ms、Sparse <2,500msの単発閾値。3,000件fixtureであり1万/10万、deep、GUI frame、実DB保存を保証しない。[tests/high_density_tree_layout_test.ts:20](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/tests/high_density_tree_layout_test.ts:20)、[tests/sparse_outline_dense_test.ts:17](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/tests/sparse_outline_dense_test.ts:17)、[tests/support/high_density_graph_fixture.ts:15](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/tests/support/high_density_graph_fixture.ts:15)

### 再現用: ファイルを作らない計測

PowerShellでrepo rootから実行。roots/100000は1回約80秒、3回で数分かかった。OS負荷の少ない状態で1processずつ行う。typedな本番入力validationを試すtestではなく、既存純粋関数への算法fixtureである。

~~~powershell
$auditCode = @'
import { buildVisibleRows } from "./src/ui/outline_view_model.ts";
import { projectBrowsingOutline } from "./src/services/browsing_navigation_state.ts";
for (const shape of ["roots", "wide", "deep"]) {
  for (const n of [1000, 10000, 100000]) {
    const items = Array.from({ length: n }, (_, i) => ({
      id: String(i), workId: String(i),
      parentId: shape === "roots" || i === 0 ? null : String(shape === "wide" ? 0 : i - 1),
      orderKey: i, collapsed: false, text: "node",
      revisionSelector: { mode: "branch", branchId: String(i) },
      createdAt: "2026-01-01", updatedAt: "2026-01-01"
    }));
    const snapshot = { items, links: [], knots: [], stashItemIds: [] };
    const projection = projectBrowsingOutline(snapshot, null);
    const ms = []; let error = "";
    for (let r = 0; r < 3; r++) {
      const start = performance.now();
      try {
        const rows = buildVisibleRows(snapshot, projection, [], false);
        if (rows.length !== n) throw new Error("row count");
        ms.push(performance.now() - start);
      } catch (e) { error = e.name + ": " + e.message; break; }
    }
    console.log(JSON.stringify({ shape, n, ms, error }));
  }
}
'@
deno eval --no-config $auditCode
~~~

実測2も同じitems生成でshape=wide/deep、N=1000/10000に限定し、次のserviceとbodyへ置換して測定した。portは試験専用であり、本番ストアの代用品ではない。

~~~typescript
import { OccurrenceOperations } from "./src/services/occurrence_operations.ts";
const service = new OccurrenceOperations({
  listItems: async () => items,
  replaceKnots: async () => {},
  listLinks: async () => []
});
const ms = [];
for (let r = 0; r < 3; r++) {
  const start = performance.now();
  const result = await service.listOutline();
  if (result.items.length !== n) throw new Error("count");
  ms.push(performance.now() - start);
}
console.log(JSON.stringify({ shape, n, ms }));
~~~

実測3は次を同様にhere-stringへ入れ、deno eval $auditCodeへ渡す（--no-configなし、既存依存を使用）。

~~~typescript
import { createHighDensityGraphFixture } from "./tests/support/high_density_graph_fixture.ts";
import { calculateTreeLayout } from "./src/ui/tree_layout.ts";
import { BranchService } from "./src/services/branch_service.ts";
import { buildSparseOutline } from "./src/services/sparse_outline.ts";
import { calculateSqliteDiff } from "./src/storage/sqlite_records.ts";
import { LINK_TYPES } from "./src/domain/models.ts";
const f = await createHighDensityGraphFixture();
const p = await new BranchService(f.store).listGlobalLineage({
  includeIsolated: true, linkTypes: [...LINK_TYPES], includeWorkIds: []
});
for (const projection of ["chronology", "lineage"]) {
  const ms = []; let nodes;
  for (let r = 0; r < 3; r++) {
    const start = performance.now();
    const layout = calculateTreeLayout(p.snapshot, {
      width: 1400, height: 800, projection, projectX: t => t / 1000,
      camera: { k: .5, x: 0, y: 0 }
    });
    ms.push(performance.now() - start); nodes = layout.nodes.length;
  }
  console.log({ projection, ms, nodes });
}
const sparseMs = [];
for (let r = 0; r < 3; r++) {
  const start = performance.now();
  const nodes = buildSparseOutline(f.projectionResults, f.items, f.links);
  sparseMs.push(performance.now() - start);
  if (!nodes.length) throw new Error("empty");
}
console.log({ sparseMs });
const before = await f.store.exportGraphState();
const after = structuredClone(before);
after.workingCopies[0].text += "x";
const diffMs = [];
for (let r = 0; r < 3; r++) {
  const start = performance.now();
  const diff = calculateSqliteDiff(before, after);
  diffMs.push(performance.now() - start);
  if (diff.upserts.length !== 1) throw new Error("diff");
}
console.log({ diffMs });
~~~

### 次段階のベンチマーク（未実行・未実装）

| 軸 | ケース |
|---|---|
| 件数 | 1,000 / 10,000 / 100,000。Work共有1/5/20配置は別試験。 |
| 形状 | 全root、root1＋全子、分岐10のbalanced、chain。深度10/100/1,000/10,000。 |
| 本文/履歴 | 80字/2KB/長文、Revision 0/10/100 per Work。まず1軸ずつ変更しB/Rを記録。 |
| link | E=0/N/8N、star hub、局所dense、循環、同時刻node。全対全は別の明示stress。 |
| 表示 | 全展開、90%collapsed、Hoist100件、viewport内外、Chronology/Lineage/年表、Sparse 10/100/500 hit。 |
| 操作 | 20文字入力、IME確定、caret移動、追加、単一移動、10%部分木移動、子多数削除、単一/全collapse、Tree切替/pan/zoom。 |
| N+1 | Stub 1/10/100、候補c、pending pを増加。RPC/store/capture/transaction/SQL本数の傾きを比較。 |

seed固定、初期化は別測定、warmup5回＋測定30回、中央値/p95/max。超過・stack例外も失敗として残す。setup時間も別記。専用DBを用意し、本番データへ大量ノードを投入しない。

観測点:

1. frontend: input→次paint、long task、Scripting/Layout/Paint/GC、DOM数、heap、同時editor数。
2. derived: visibleRows/browsing/recent/annotations/tree layout/Lineageの操作当たり回数と累積時間。
3. RPC: method別件数、bytes、待機時間。renderer JSON化とbackend時間を分離。
4. backend: listItems、detectKnots、recursivePlacements、capture、validation、diff、transaction、cache保存。
5. 保存: changed record数対走査record数/SQL upsert数、子d/m/S対回数。全体cloneの回数とtransactionを混同しない。
6. correctness: 行順、昇格後親子、Knot、同branch同期、pinned read-only、IME/focus/caret、draft、stale response、rollback、再起動。

仮の目標はinput→paint p95<50ms、通常単件p95<100ms、pan/zoomはframe budget（60Hzなら約16.7ms）。現状保証や既存仕様ではなく、合意用の目安。保存durability完了はpaintと別指標にする。

### プロファイリング入口・計測できなかった項目

- deno task desktop:inspectは127.0.0.1:9230の既存入口。CEF renderer/Deno targetを区別する。[deno.json:59](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/deno.json:59)
- deno task desktop:audit --help、--target renderer/deno、--expressionでDOMやDeno.memoryUsageを取得できる。現行scriptはconsole/exception/network failureとsummaryが中心で、CPU/frameの自動suiteではない。[scripts/desktop_cdp_audit.ts:161](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/scripts/desktop_cdp_audit.ts:161)、[scripts/desktop_cdp_audit.ts:305](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/scripts/desktop_cdp_audit.ts:305)、[scripts/desktop_cdp_audit.ts:439](C:/Users/Yudai/ghq/github.com/asadaame5121/Radiora/scripts/desktop_cdp_audit.ts:439)
- renderer DevToolsのPerformance/Memory、利用可能ならCDP Profiler/Tracing。Deno targetの対応domainを確認し、両targetが同じdomainを持つとは仮定しない。DOM総数はdocument.querySelectorAll("*").length、editor数はtextarea[data-item-id]で観測できる。
- desktopを起動せず、user DBも操作していないため、描画、実RPC本数、frame、SQLite I/Oは未測定。隔離fixtureと起動条件が必要。derived trace/精密SQL counter等、コード変更が必要な測定は今回提案に留めた。
- 新規bench/test file、Svelte $inspect.trace挿入は行っていない。既存testの実行失敗と純粋関数測定成功は別結果。

未確認: GUI応答、実DB保存/障害時性能、release CEF/webview比較、最大heap/GC/p95。  
主要リスク: 全体検証・rollback・draft保護を最適化時に単純省略すると整合性/未保存入力を損なう。操作単位の反復削減と計測から進める。
