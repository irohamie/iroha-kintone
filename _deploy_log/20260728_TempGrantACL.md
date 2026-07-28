# 一時作業：35アプリへのgithub-botアプリ管理権限 一括付与

- 実行日：2026-07-28
- 認証：まーくん本人の資格情報（TEMP_ADMIN_USERNAME / TEMP_ADMIN_PASSWORD）
- 対象：35アプリ（10, 11, 30, 42, 46, 50, 67, 128, 133, 137, 139, 141, 142, 144,
  146, 147, 160, 161, 162, 163, 207, 211, 216, 219, 220, 221, 222, 225, 229,
  230, 231, 232, 233, 236, 237）
- 実行ワークフロー：`.github/workflows/temp-grant-acl.yml`（Run #1: 30341721029, Run #2: 30342162411）

## 結果

- 新規追加：33アプリ（App10, App42を除く全対象）
- 変更不要（付与済み）：2アプリ（App10, App42）
- エラー：0件
- 全35アプリで運用環境（`GET /k/v1/app/acl.json`）にgithub-botの
  `appEditable: true` を確認済み

## 経緯（Run #1失敗の原因と対処）

Run #1で`POST /k/v1/preview/app/deploy.json`が全アプリでHTTP 400
（`code=CB_VA01, message=Missing or invalid input.`）となった。
`app`/`revision`を文字列のまま送信していたことが原因と判断し、
`Number()`に変換して送信するよう修正（該当コミット参照）。

Run #2実行時点で、Run #1の`PUT /k/v1/preview/app/acl.json`が
運用環境にも即時反映されていたことが判明した（`GET /k/v1/app/acl.json`で
確認したところ、35アプリすべてで反映済み）。ACLはcustomize.json等と異なり
preview→deployの反映待ちを要さない可能性が高い。`docs/01_設計図.md`の
確認・更新を別途提案する。

## 安全対策の実施記録

- 書き込み前に対象アプリごとのACL（変更前）を`_backup_before/{YYYYMMDD}_App{ID}_acl/acl_before.json`
  として退避し、コミット・push（33件）。すべて成功。
- 既存のACLエントリは1件も変更・削除せず、末尾への追記のみ実施。
- `revision: -1`は一切使用していない。
- レコード系権限（recordViewable等）はすべてfalseのまま。

## 完了後の対応

`TEMP_ADMIN_USERNAME` / `TEMP_ADMIN_PASSWORD` はこの一時作業専用であり、
今後不要。GitHub Secretsからの削除をまーくんに依頼済み。
