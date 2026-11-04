# Expected: quarantine invalid payloads

- Fixture JSON自体はvalid。各recordの`payloadSource`はSQLiteのpayload TEXTへそのまま書く原文。
- 7 recordすべてをarchive件数に含める（metadata込みのlegacy_archiveは8行）。
- 正常なwork/feedbackの2 recordだけがLegacySource.recordsへ入る。
- JSON構文不正、型不正、歴史年代yearの1e400、孤立UTF-16 surrogate、identity不一致の5
  recordは隔離する。
- 各隔離recordについて診断を1件ずつ保存する。severity=error、kind=invalid-record、action=archived-only。
- 隔離行はLoro文書には出ない。I4/I5未実装のため今回の自動試験はtyped
  recordsからの除外までを確認する。
- 隔離されたIDへの参照はI1 oracleのResolution::Missing扱いとし、別recordへリダイレクトしない。
- 全recordのid/position/payload原文、row/table hash・件数・bytesを照合する。
- main DB/WALのsize・mtime・SHA-256が不変。import_runは文書層未完のrunningのまま。
- arbitrary_precisionは変更しない。1e400はここでは歴史年代yearの範囲検証で失敗する。
  既存validatorが受け入れるnumber fieldの1e400を新たに拒否するfixtureではない。
