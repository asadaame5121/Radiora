# 更新予定

更新日: 2026-09-23。優先順位は実際の利用と開発状況に応じて見直す。 進捗と段階は
[Radiora Roadmap Project](https://github.com/users/asadaame5121/projects/1) と各Issueで追跡する。

## 進行中

1. **[リファクタリング](https://github.com/asadaame5121/Radiora/issues/204)** —
   既存機能の責務と状態の所有を整理する。作業単位と着手順は
   [リファクタリング・バックログ](refactoring-candidates.md)を参照。変更対象の必要な構造整理を先に行う。

## 次に進める

- **[OperationLog](https://github.com/asadaame5121/Radiora/issues/209)** —
  機能の整理、UI改善、エラー調査の判断材料にする。開発版には常時記録する。
  配布版は端末内保存を基本案とし、自動送信は予定しない。本文・検索語・項目名は記録しない。
  記録は30日で自動削除し、利用者がいつでも全削除できるようにする。実装前に記録するイベント、
  容量上限、確認・任意の共有方法を決める。既存の `startup.log` にも同じ保存期間を適用し、
  診断ログ全体で扱いを揃える。[配布時の説明とプライバシーポリシー](https://github.com/asadaame5121/Radiora/issues/211)は
  実際の記録・共有方法に合わせて整える。 開発版と配布版は同じコードからビルドし、配布CIの
  `--release` で記録範囲を切り替える。
- **[WindowsのMSIX配布](https://github.com/asadaame5121/Radiora/issues/212)** —
  既存の[MSIX作成手順](msix-distribution.md)をリリース経路へつなぎ、
  署名、インストール、更新を実機で確認する。SmartScreen警告と更新体験に関わるため優先する。

両方とも近い優先度とし、リファクタリングの作業単位を崩さず進める。

## 利用状況を見て判断

- **[キーボード操作の改善](https://github.com/asadaame5121/Radiora/issues/214)** —
  既存のショートカットとコマンドパレットを前提に、まず検索・Outline・
  Tree・原稿間のフォーカス移動と、項目間移動・元位置への復帰をキーボードだけで試す。
  一連の操作をE2Eで確認し、詰まる箇所に限ってショートカットを追加する。

## Phase 6: 計量するドッグフーディング

[Phase 6](https://github.com/asadaame5121/Radiora/issues/72)は、
[OperationLogのイベントと集計基準](https://github.com/asadaame5121/Radiora/issues/210)を固定してから開始する。
28日間の操作件数、成功・失敗、所要時間、利用ゼロと計測欠落を区別して確認する。
使いにくさなどの定性的な事例は個人情報を除いてGPTと相談し、採用する改善策を個別Issueにする。

## 保留

- **新しい利用者向け機能** — 直近の追加予定は置かない。OperationLogと実使用の結果を見て、
  既存機能の整理やUI改善を先に判断する。[歴史年表の計画](https://github.com/asadaame5121/Radiora/issues/186)
  はモデル部分まで進んでいるが、残りの実装は当面の優先対象から外す。
- **[Webアプリ化](https://github.com/asadaame5121/Radiora/issues/215)** —
  将来の選択肢として残す。現在はデスクトップ版の責務整理を優先する。
- **[READMEなどの国際化](https://github.com/asadaame5121/Radiora/issues/216)** —
  実際の利用場面が見えてから着手する。現時点では低優先度。
