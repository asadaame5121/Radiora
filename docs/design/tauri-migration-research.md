# Tauri移行に向けた一次資料調査

調査日: 2026-10-11（日本時間）。対象: Tauri 2、petgraph、ELK.js、Dagre、およびDenoの保守方針。
この文書は確認できた外部仕様と、2026-10-11時点の設計上の推論を分ける。
採用優先度は2026-10-30接合後の[移行計画](tauri-migration-plan.md)と[縦Tree調査](vertical-tree-library-research.md)を参照する。
以下の「既存SVG/D3を先行」等は当時の提案であり、現在の縦Tree工程の必須条件ではない。

## Denoの保守終了

**確認済み**:
Deno公式は2026-10-09、DenoチームのCloudflare参加と、独立したruntime/hostingの開発からの転換を発表した。Deno
runtimeは発表からさらに1年間、月次でbug fix/security
updateを提供し、その後Denoチームによる開発を終了する。OSSは残り、第三者による開発継続は歓迎される。Deno
Deployの6か月後終了は別の期限である。[Deno公式発表](https://deno.com/blog/cloudflare)

**不明**: この発表にはDeno Desktop単独の更新保証・終了日・移行支援の明記はない。「Deno
Desktopはすでに動かない」「OSS全体が消える」とは読み取れない。

**設計への推論**: Deno
Desktop依存を減らす判断には根拠がある。期限は「現時点でruntime停止」ではなく「開発元の保守終了が予告された」と記録する。

## Tauri 2とSvelte

**確認済み**:

- TauriのRust Core
  processはOSアクセス、window管理、IPC、DB接続等の共有状態を担う。WebViewはHTML/CSS/JavaScriptを実行する。公式にはSvelte/Vite使用例もあり、Svelteを捨てる必要はない。WindowsはWebView2、macOSはWKWebView、Linuxはwebkitgtkを使うため、OS間の表示差は残る。[Process Model](https://v2.tauri.app/concept/process-model/)
- フロントからRust commandをPromiseを返す `invoke` で呼べる。引数はSerde Deserialize、返却値はSerde
  Serializeを要する。通常の返却値はJSONへ変換され、`Result::Err` はPromise
  rejectionになる。非同期commandは別async
  task上で動く。[Calling Rust](https://v2.tauri.app/develop/calling-rust/)
- capabilitiesはwindow/WebViewごとのpermissionを定義する。複数capabilityの対象になるwindowでは権限が合成される。独自の
  `invoke_handler` 登録commandはデフォルトで全window/WebViewから呼べるため、制限には
  `AppManifest::commands`
  等の明示設定が必要。[Capabilities](https://v2.tauri.app/security/capabilities/)
- 公式SQL
  pluginはSQLite/MySQL/PostgreSQLと、Rust側で登録するmigrationを提供する。migrationはtransaction内で実行され、失敗時は全体をrollbackする。JavaScript側SQL
  APIも公開する。[SQL plugin](https://v2.tauri.app/plugin/sql/)

**設計への推論**: Rust
graph結果とフロントlayoutの分離は実現可能。ただしSerdeで型を読み取れることと、業務上のID・範囲・関係制約が正しいことは別なのでIPC両側の検証を省略しない。async化だけでCPU処理の実行時間が短くなるわけではなく、重いgraph計算はblocking
worker等の実行方式を別途評価する。

**範囲外**: Tauri採用はDB変更を要求しない。Radioraの現行DBはすでにSQLiteであり、SQL
pluginの存在だけで保存adapterの採用を決めない。保存方式はデータ互換性とrepository境界を調査して別途決める。

## petgraphで任せられる範囲

**確認済み**:

- `Graph`、`StableGraph`、`GraphMap`等のデータ構造とgraph
  algorithmsを提供する。DFS/BFSはvisit、経路探索や循環判定等はalgoにある。[petgraph](https://docs.rs/petgraph/latest/petgraph/),
  [algo](https://docs.rs/petgraph/latest/petgraph/algo/)
- `StableGraph`
  はnode/edge削除時に無関係なindexを変えない。index空間には削除による穴ができる。これは永続的な業務IDを保証する説明ではない。[StableGraph](https://docs.rs/petgraph/latest/petgraph/stable_graph/struct.StableGraph.html)
- `toposort`
  は自己loopを含む循環に対してErrを返す。時間計算量はO(V+E)。循環を許すgraphにはSCC等を使うよう案内される。[toposort](https://docs.rs/petgraph/latest/petgraph/algo/fn.toposort.html)
- `kosaraju_scc`
  は強連結成分を返す。各成分内のnode順は任意である。[kosaraju_scc](https://docs.rs/petgraph/latest/petgraph/algo/scc/kosaraju_scc/fn.kosaraju_scc.html)

**設計への推論**:
petgraphへ探索・到達性・循環検出を委任できる。画面に出す親子関係、複数親、同一実体の複数出現、子順、fold、filterの意味はRadiora側の契約であり、libraryへ移すだけでは決まらない。IPCには既存の業務ID/表示出現IDを使い、NodeIndexを永続化契約にしない。libraryの走査順をそのままUIの安定した順序として扱わない。

## ELK.jsとDagreの違い

| 項目     | ELK.js                                             | Dagre                                                  |
| -------- | -------------------------------------------------- | ------------------------------------------------------ |
| 主な責務 | graphの座標・edge route計算                        | directed graphの座標・edge route計算                   |
| 寸法     | 入力nodeにwidth/heightを渡す                       | 入力nodeにwidth/heightを渡す                           |
| 実行     | Promise API、Web Worker利用を公式対応              | `dagre.layout(g)` による計算。Worker化は別途統合が必要 |
| 適用候補 | ports、compound graph、階層を跨ぐedge、複雑なroute | 単純な階層graphの配置候補                              |
| 描画     | 別途rendererが必要                                 | rendering agnosticで別途rendererが必要                 |

表の根拠: [ELK.js README](https://github.com/kieler/elkjs),
[Dagre公式Wiki](https://github.com/dagrejs/dagre/wiki)

**確認済み**:

- ELK.jsにはlayered、mrtree、radial等のalgorithmがあり、`workerUrl` 等でWeb
  Workerへ計算を委ねられる。これは自動的なSvelte
  DOM描画やnode寸法測定を提供するものではない。[ELK.js README](https://github.com/kieler/elkjs)
- ELK Layeredはstraight/orthogonal/spline routing、ports、self loops、multi edges、compound
  graphを扱う。階層を跨ぐedgeは対応optionの有効化が必要。[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- Dagreの公式npm名は
  `@dagrejs/dagre`。node寸法を入力し、結果としてnode中心座標とedgeのpointsを得る。方向、間隔、ranker、循環処理用acyclicer等のoptionがある。公式の設計優先事項にはclient-side計算と中規模graphの速度が含まれる。[Dagre公式Wiki](https://github.com/dagrejs/dagre/wiki)

**設計への推論**:
「Rustが構造、フロントが寸法と配置、Svelteが描画」は責務分離として自然。libraryに任せられるのはlayoutであり、選択・キーボード操作・drag/drop・virtualization・フォーカス・accessibilityまで含むtree
widgetではない。操作まで委任したい場合はrenderer/widgetの別調査が必要。

## Svelte Flowを描画・操作に使う場合

**確認済み**: `@xyflow/svelte` はSvelte componentをcustom
nodeとして登録でき、選択、drag、接続handle等を備える。viewportはpan/zoom/範囲選択を提供し、keyboard
accessibilityを設定できる。[Custom Nodes](https://svelteflow.dev/learn/customization/custom-nodes),
[Viewport](https://svelteflow.dev/learn/concepts/the-viewport),
[SvelteFlow API](https://svelteflow.dev/api-reference/svelte-flow)

**確認済み**: Svelte Flowはlayout
engineを内蔵する代わりに外部libraryとの統合を案内し、Dagre/ELKの使用例を提供する。layoutと描画・操作は別の採用判断になる。[Layouting overview](https://svelteflow.dev/learn/layouting/overview)

**設計への推論**: node
editorとしての自由移動・接続・範囲選択を委任する候補にはなる。既存のtree固有操作、fold、再親化、表示出現ID、Workspaceによる選択ownershipを自動的に保存するものではない。既存Svelte描画を維持してTauriを先に検証し、操作基盤の置換は専用prototypeで判断する方が移行時の変更範囲を抑えられる。

## 採用前に実データで確かめること

以下は一次資料だけでは確定できない。

1. 現行tree layoutとの順序・配置安定性、長い日本語ラベル、折返し、可変node寸法の一致。
2. fold/filter/再親化後のviewport、selection、focus維持。
3. 同一実体の複数出現、複数親、循環、孤立nodeを含む表示projectionの意味。
4. 実際の最大graphでのIPC転送量、計算時間、DOM描画時間、メモリ、操作応答。
5. Tauriの配布buildでのWorker asset URL/CSPとWebView2の挙動。
6. 各依存の固定version、license同梱、更新手順。

今回、依存導入、ベンチマーク、配布build、OS実機検証は行っていない。性能と現在の操作契約の互換性は未検証であり、ドキュメント上の機能だけで採用確定しない。
