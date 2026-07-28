# Phase 5：本番デプロイ運用の開始

**本番アプリへの書き込みが発生します。**

## 前提の確認（あなたがやること）

1. Phase 4 のロールバック実地検証と故意破壊テストが成功していることを、
   `_deploy_log/` の記録から確認して報告する
2. まーくんに GitHub Environments の設定状況を確認する

未設定の場合、以下をボタン単位で案内する。

1. ブラウザで `https://github.com/irohamie/iroha-kintone` を開く
2. 画面上部のタブから「Settings」をタップ
3. 左メニューの「Environments」をタップ
4. 「New environment」ボタンをタップ
5. Name欄に `production` と入力し「Configure environment」をタップ
6. 「Required reviewers」のチェックボックスをオンにする
7. 現れた入力欄に `irohamie` と入力して選択
8. 「Save protection rules」をタップ

## 作るファイル：.github/workflows/manual-deploy.yml

1. トリガーは `workflow_dispatch` のみ
   【絶対禁止】`schedule` と `push` トリガーを付けること
2. `inputs`
   - `app_id`：対象アプリID（`required: true`、`type: string`）
   - `confirm`：確認用にアプリIDを再入力（`required: true`、`type: string`）
   - `source`：送信元フォルダパス（`required: false`。空なら本体フォルダを使う）
   - `allow_remove`：ファイル数が減ることを許可（`type: boolean`、`default: false`）
3. ジョブを2つに分ける

   **ジョブ1（environment 指定なし）**
   1. `actions/checkout@v4`（`fetch-depth: 0`）
   2. `actions/setup-node@v4`（`node-version: 20`）
   3. `node scripts/04_preflight.js --app={app_id}`
   4. `node scripts/05_snapshot_before.js --app={app_id}`
   5. `node scripts/06_push_preview.js --app={app_id} --source={source} [--allow-remove]`
   6. ジョブサマリに「kintoneのアプリ設定画面で目視確認してから承認してください」を出力

   **ジョブ2（`needs: ジョブ1`、`environment: production`）**
   7. `actions/checkout@v4`（`fetch-depth: 0`）
   8. `actions/setup-node@v4`（`node-version: 20`）
   9. `node scripts/07_deploy.js --app={app_id} --confirm={confirm}`
   10. `_deploy_log/` をコミット・push

4. `permissions: contents: write`
5. `env` で Secrets の3つを両ジョブに渡す
6. `git config` の `user.name` は `irohamie`、`user.email` は `npo@iroha-mie.com`

【設計意図】ジョブを2つに分け、ジョブ2に `environment: production` を付けることで、
テスト環境への反映後・運用環境への反映前にGitHub側で処理が自動停止し、
まーくんの承認タップを待つ状態になります。これが最終確認のゲートです。

## 最初の本番デプロイ（あなたが主導する）

対象は `App231_担当表` または `App225_3町月次報告` を推奨します。
理由：他アプリから参照されておらず、影響範囲が限定的なため。
まーくんに対象を確認してから進めてください。

実行手順（起動と監視はあなたが行う。まーくんの操作は目視確認と承認のみ）：

1. あなたが `POST .../actions/workflows/manual-deploy.yml/dispatches` を送って起動する
   - `inputs`: `{ app_id, confirm, source: "", allow_remove: false }`
2. ジョブ1（preflight・退避・テスト環境反映）の完了を、あなたがAPIでポーリングして待つ
3. まーくんに目視確認を依頼する
   「kintoneで対象アプリを開き、歯車マーク →『設定』タブ →
   『JavaScript / CSSでカスタマイズ』でファイル名と並び順を確認してください」
4. まーくんの承認操作（ここだけは人の手作業。安全のための意図的なゲート）
   1. Actionsタブを開き、実行中のワークフローをタップ
   2. 「Review deployments」をタップ
   3. `production` にチェックを入れ「Approve and deploy」をタップ
5. ジョブ2（運用環境への反映）の完了を、あなたがAPIでポーリングして待つ
6. `_deploy_log/` の内容をあなたが取得し、Gate 7 の照合結果を報告する
7. まーくんにkintoneでの最終動作確認を依頼する

## 検証（あなたがやること）

1. ワークフローの実行ログを取得し、7つのゲートすべてが通過したことを確認して報告
2. `_deploy_log/` の記録内容を読み、MD5照合結果を報告
3. 問題があれば、あなたが原因を特定し、ロールバック手順を提示する

## 最後にやること

1. コミット・push（メッセージ：`Phase 5：手動デプロイワークフローと承認ゲートを追加`）
2. `CLAUDE.md` 9章の進捗表を更新してコミット
3. 「Phase 6 に進んでよいか」をまーくんに確認して停止する
