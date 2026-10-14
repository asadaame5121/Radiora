# Tree性能是正の先行契約（P6）

これはmainへ先にマージする設計契約であり、最適化の完了記録ではない。
状態所有の正本は[Tree所有契約](tree-state-ownership.md)と
[UI所有契約](ui-state-ownership.md)に従う。

## 維持する契約

- ChronologyとLineageの投影、FROMの向き、Workから代表Occurrenceへの投影を維持する。
- panはscreen座標だけを変え、world座標、lane、衝突集約の所属とcluster IDを変えない。
- 衝突はx差48未満かつy差36未満。境界での接触は衝突に含めない。
- LOD、clusterの代表項目・bounds・Knot表示・リンク集約は全ペアoracleと一致させる。
- 循環はKnot帯へ分離し、非循環の世代は最も深い親に従う。
- 選択、focus、projection変更、filter変更、viewport変更、cluster操作を維持する。

## 後続の実装境界

1. グラフ処理: lane近接順の反復走査と、Lineage世代計算のhead付きqueue。
   mainのSCCは既に反復処理である。旧PRの再帰版に戻さない。
2. 空間集約: screen衝突・cluster・edge集約を純粋moduleへ分離し、
   非衝突の隣接bucketでも比較回数を制限する。
3. lane割当: 先頭の利用可能laneをrange minimum treeで探す。
4. world/camera: snapshot、投影、寸法、zoomからworld layoutを作り、panで再計算しない。
5. View: world layoutをderivedで保持し、screen cameraだけを適用する。toolbarをViewへ分離する。

world layoutの再利用には同じzoomを必要とする。zoom・投影・snapshot・寸法が変われば失効する。
ControllerのI/O寿命やTree read modelの更新境界はこの変更に取り込まない。
元PRに混在するOutline局所操作のP4境界文書は、このP6完了記録として扱わない。

## マージと受入

現行公開APIの回帰テストとこの文書はmain向けの独立PRにし、実装より先にマージできる。
先行テストはpan、入力順、世代と衝突oracleを固定する。skip・ignoreを追加しない。
新moduleの直接テスト、6,000件の深い鎖、2,000件hub、比較回数の上限、
Viewのworld再計算回数は対応する実装PRで有効なAPIへ接続し、先行回帰も毎段階で再実行する。
先行テストの成功は性能改善の達成を意味しない。release renderer traceと
main/candidate比較による体感性能の判定はP7に残す。
