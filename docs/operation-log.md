# OperationLog

Radioraは、利用者が実行した主要操作と画面遷移を端末内のJSONLに記録します。入力本文、検索語、項目名、対象ID、エラーメッセージは記録しません。記録には日時、操作名、成否、処理時間、アプリ起動ごとのランダムなセッションIDが入ります。自動送信はありません。

保存先はWindowsでは `%LOCALAPPDATA%\RadioraV2\logs` です。`operation-*.jsonl` と診断用の `startup*.log` は別々に管理し、それぞれ30日・20 MBを上限として古いファイルから削除します。Optionsの「操作記録」で集計と直近の記録を確認でき、JSONLを書き出せます。「診断ログをすべて削除」は両方を削除します。通常のJSONバックアップにログは含まれません。

詳しい分析には、書き出したファイルをPythonで集計できます。標準ライブラリだけで動きます。

```sh
python scripts/analyze_operation_log.py radiora-operations-YYYY-MM-DD.jsonl summary.csv
```

`summary.csv` は日別・操作別・成否別の件数と平均処理時間、`summary-sessions.csv` はセッション内の時系列です。共有する場合は、利用者自身がファイルの内容を確認してから任意の方法で渡します。
