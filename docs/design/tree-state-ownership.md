# Tree state ownership

2026-10-04。#204 の T1→T2→T3 および #296/#297 の実装契約。 #295
の全UI所有表は別作業とし、この文書はTreeの境界だけを確定する。
ユーザー指定のT1→T2→T3を一括PRで実装するため、#296の前提となるTreeの所有契約を
先にこの範囲で確定した。#295全体の完了や、他featureの実装完了は意味しない。

| 状態                            | owner / writer                                    | 読み手・寿命・失効                                                                                              |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 保存済みWork/Link               | backend/API                                       | Treeは取得したread modelを描画する                                                                              |
| projection preference           | `TreeController.setProjection`                    | App寿命。OptionsとTreeはpropsと変更callbackで共有。localStorageのwriterはControllerだけ                         |
| filter preference               | `TreeController.setFilter` / `reconcileRelations` | App寿命。localStorageへ保存する`includeWorkIds`は空。startup・relation type変更・JSON復元も同じ入口             |
| 選択Workの表示例外              | `TreeController.activeFilter` の派生値            | Appの現在の選択をportで読む。Controllerへ選択stateを複製せず、保存もしない                                      |
| Tree結果・error・loading        | `TreeController.prepareRefresh` / `refresh`       | App寿命。要求世代と取得時filter keyが一致する結果だけ公開する                                                   |
| 要求世代・公開済みkey           | `TreeController` の非Runeフィールド               | filter/選択変更、Treeから離れる際のeffect cleanup、disposeで失効。古い成功・失敗・finallyは新しい要求へ書かない |
| camera・hover・寸法             | `PhylogeneticTree`                                | View instance寿命。選択はprops/callback。fitは既存`tree_camera.ts`を使う                                        |
| cluster inspection・sidebar tab | `GlobalLineage`                                   | View instance寿命。filterで消えたclusterを解放する既存effectを維持                                              |

## 取得と公開

Appのreloadは`prepareRefresh`で要求を作り、outline・Tree・bookmarkの取得を並行する。
取得結果は要求scope内部に保留し、Appへは完了Promiseだけを渡す。
すべて成功した後に引数なしの`publish`を呼び、どれか失敗すればその要求だけを`cancel`する。
loadingはTree APIの完了時ではなく公開・中止・失敗時に解除する。
Viewはloading/errorを表示し、初回失敗と既存結果を保持した更新失敗の両方で再試行できる。
公開時には取得時の世代とfilter keyを照合するため、取得中に変わった選択/filterの結果を
現在の結果として扱わない。別の最新要求を古いreloadのcancelで失効させない。
Outlineのdraft保持と選択補正は既存のApp/workspaceが担当する。

Tree表示中のeffectはview・filter・選択Workだけを追跡し、`untrack`内で必要な取得を開始する。
result/error/loadingへの書込でeffectを再発火させない。cleanupはControllerの要求を失効させる。
投影方式の変更はpropsでViewへ届き、`tick`後の更新済みlayoutをfitする。
投影が再変更された場合やunmount時は予約したfitを取り消す。
fitの失敗は原因付きでconsoleへ報告する。前回投影の非Rune値は初回mountのcameraを
変更しないためのeffect履歴で、永続設定のownerではない。 GlobalLineageはTree feature内のcomposition
Viewとして投影props/callbackを配線する。 この短い親子経路に別のcontext ownerは追加しない。

## pointer / layout

`connectTreePointer`はResizeObserver、SVG listener、D3のSVG座標変換・mouse/touch/wheel操作を
接続するadapter。cameraの公開値を保持するownerにはしない。 D3はmouse gestureをwindowのcapture
listenerで継続する。disposeはSVG listener、observer、 transitionと進行中のwindow
gestureを解放し、native drag/selectionを復元する。 独自のpointer
capture方式へ置換せず、D3の既存操作契約を維持する。

`visibleContextLabels`はscreen空間の純粋なhit判定。
`tree_lineage_projection.ts`は世代計算、`tree_lineage_cycles.ts`はSCCの循環membership、
`tree_lane_order.ts`はoutline/semantic近接順を所有する。
layoutのedge代表Occurrenceとlaneの代表Occurrenceは既存の異なる選択規則を保持する。

## 回帰検証

既存layout・高密度fixture、循環moduleとhit判定の直接テスト、Controllerの応答逆順・失敗・
reload公開/中止・選択例外・設定再読込テストを使う。
ブラウザではpan/zoom、gesture中のunmount、再mount、Tree↔Optionsと再起動の設定共有を確認する。
