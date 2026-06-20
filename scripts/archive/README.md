# archive/ — 実行済みワンオフスクリプト（再実行禁止）

これらは **本番に対して一度だけ実行済み** の移行・バックアップスクリプトです。
履歴・参照用に残していますが、**再実行しないでください**。

| スクリプト | 用途 | 再実行のリスク |
| --- | --- | --- |
| `migrate-direct-to-wholesale.mjs` | 旧 `sales`/`buyers` を `wholesale_orders`/`wholesale_members` + `ec_sales` 台帳へ移行（決定的IDで冪等） | `--commit` 再実行で取消済み注文の在庫ホールドが復活し得る／在庫整合が崩れる |
| `backup-collections.mjs` | 移行前の全コレクションを `scripts/backups/` へ JSON 退避 | 既存バックアップを上書きし得る |
| `restore-collections.mjs` | バックアップからの復元（緊急時のみ） | 現行データを **破壊的に上書き**。実行前に必ず内容確認 |
| `dedupe-ec-sales.mjs` | `ec_sales` 重複レコードの一括整理 | 正当なレコードを誤削除し得る |
| `migrate/` | 旧 DB（`chaflow`）→ `matcha-console` への Firestore/Auth/Storage 移行 | ソース DB は既に廃止。再実行不可 |

緊急の復元が本当に必要な場合のみ `restore-collections.mjs` を使い、事前に
`scripts/backups/` の対象 JSON を確認し、対象 databaseId（`matcha-console`）を二重確認すること。
