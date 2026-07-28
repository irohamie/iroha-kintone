# 一時的な作業：35アプリへのアプリ管理権限一括付与

**この作業は Phase 0〜7 の連番Phaseとは別枠の、一回限りの特別作業です。**
`TEMP_ADMIN_USERNAME` / `TEMP_ADMIN_PASSWORD`（まーくん本人の資格情報）を使います。
通常の `github-bot` より遥かに強い権限のため、以下を徹底してください。

## 前提条件（着手前に必ず確認）

1. `config/apps.json` が Phase 1 の実行により最新化されていること
   （IDと実際のアプリ名の対応が、まーくんによって目視確認済みであること）
2. 対象アプリIDが以下の35個で確定していること（まーくんの確認結果を待つ）
   ```
   10, 11, 30, 42, 46, 50, 67, 128, 133, 137, 139, 141, 142, 144, 146, 147,
   160, 161, 162, 163, 207, 211, 216, 219, 220, 221, 222, 225, 229, 230,
   231, 232, 233, 236, 237
   ```
3. GitHub Secrets に `TEMP_ADMIN_USERNAME` / `TEMP_ADMIN_PASSWORD` が
   登録済みであること（まーくんに確認する）

## 作るファイル1：scripts/lib/kintone_admin.js

`scripts/lib/kintone.js` とほぼ同じだが、認証に
`TEMP_ADMIN_USERNAME` / `TEMP_ADMIN_PASSWORD` を使う版。コードの重複を避けるため、
`kintone.js` の内部関数を環境変数名だけ差し替えて呼べるよう、
共通ロジックを `lib/kintone_core.js` に切り出し、`kintone.js` と `kintone_admin.js` の
両方から使う構成にしてよい（実装しやすい方でよいが、パスワードの出力禁止など
安全ルールは両方に同様に適用すること）。

## 作るファイル2：scripts/99_grant_acl_bulk.js

引数：`--apps=10,11,30,42,...`（カンマ区切り。上記35個をデフォルト値としてもよい）

必須の実装内容：

1. `kintone_admin.js` を使い、対象アプリを1つずつ処理する（1アプリの失敗で全体を止めない）
2. 各アプリについて `GET /k/v1/preview/app/acl.json?app={id}` で**現在のACLを取得**する
   - `rights`（エントリの配列）と `revision` を得る
3. 【最重要】取得した `rights` 配列の中に、`entity.code` が `github-bot` の
   エントリが**既に存在するか**確認する
   - 既に存在し、`appEditable`（アプリ管理相当の権限）が既に `true` なら、
     そのアプリは「変更不要」として記録し、書き込みを行わない（べき等性の確保）
   - 存在しない場合のみ、次の手順へ進む
4. 既存の `rights` 配列は**1件も変更・削除しない**。末尾に以下のエントリを追記する
   ```json
   {
     "entity": { "type": "USER", "code": "github-bot" },
     "appEditable": true,
     "recordViewable": false,
     "recordAddable": false,
     "recordEditable": false,
     "recordDeletable": false,
     "recordImportable": false,
     "recordExportable": false,
     "includeSubs": false
   }
   ```
5. Gate：送信前に、新しい配列の長さが「元の長さ + 1」であることを確認する。
   異なる場合（既存エントリが減っている等）は送信せず、そのアプリをエラー記録する
6. `PUT /k/v1/preview/app/acl.json` に `app` / `rights`（全件） / `revision` を送信
   - 【禁止】`revision` に `-1` を指定すること
7. 送信後、`GET /k/v1/preview/app/acl.json?app={id}` で再取得し、
   - 元からあったエントリが1件も減っていないこと
   - `github-bot` のエントリが追加され、`appEditable: true` になっていること
   を確認する。異常があれば、そのアプリだけエラー記録して次へ進む
8. **この時点ではテスト環境（preview）のみの変更。運用環境への反映（deploy）は別途行う**
9. 全アプリの結果を「アプリID／アプリ名／処理前エントリ数／処理後エントリ数／結果」の
   表形式で表示する（新規追加／変更不要／エラー の3種類で表示）

【絶対禁止】既存の `rights` エントリを1件でも書き換える・削除すること
【絶対禁止】`recordViewable` 等のレコード系権限を `true` にすること
【絶対禁止】`revision` に `-1` を指定すること

## 作るファイル3：scripts/99b_deploy_acl_bulk.js

引数：`--apps=10,11,30,...`（`99_grant_acl_bulk.js` で新規追加した対象のみ）

1. 対象アプリごとに `POST /k/v1/preview/app/deploy.json` で運用環境へ反映
2. `GET /k/v1/preview/app/deploy.json?apps[0].app={id}` をポーリングし `SUCCESS` を待つ
3. 反映後、運用環境の `GET /k/v1/app/acl.json?app={id}` を取得し、
   `github-bot` のエントリが存在し `appEditable: true` であることを確認する
4. 全アプリの結果を表形式で報告する

## 作るファイル4：.github/workflows/temp-grant-acl.yml

1. トリガーは `workflow_dispatch` のみ
2. `inputs`：`apps`（カンマ区切りの対象ID、デフォルトで上記35個）
3. ステップ：`99_grant_acl_bulk.js` → 結果表示 → `99b_deploy_acl_bulk.js`
4. `env` に `TEMP_ADMIN_USERNAME` / `TEMP_ADMIN_PASSWORD` を渡す
   （`KINTONE_USERNAME` / `KINTONE_PASSWORD` とは別の変数名。混同しないこと）
5. `permissions: contents: read`（このワークフローは設定変更のみで、Gitへの書き込みは無い）

## 実行と検証（あなたがやること）

1. 4ファイルをコミット・push
2. GitHub APIで `temp-grant-acl.yml` を起動する
3. 完了までポーリングし、失敗時はログを取得して原因を特定する
4. 結果の表（35アプリ分）を日本語でまーくんに報告する
5. **報告の最後に、必ず以下を明記すること**

   「作業が完了しました。`TEMP_ADMIN_USERNAME` と `TEMP_ADMIN_PASSWORD` は
   もう不要です。GitHubの Settings → Secrets and variables → Actions を開き、
   この2つを今すぐ削除してください。削除手順：該当のSecret行にある
   ゴミ箱マーク（Remove）をタップし、確認ダイアログで削除を確定してください。」

## 最後にやること

1. コミット・push（メッセージ：`一時作業：35アプリへgithub-botのアプリ管理権限を一括付与`）
2. `_deploy_log/` に一括付与の実行記録を残す（通常のデプロイログと同じ書式でよい）
3. `CLAUDE.md` に「一時作業は完了。TEMP_ADMIN系のSecretsは削除依頼済み」の記録を追記
4. まーくんにSecrets削除の完了確認を依頼して停止する
