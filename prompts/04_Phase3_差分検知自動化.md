# Phase 3：差分検知の自動化

kintoneへの書き込みは発生しません。

## 作るファイル：.github/workflows/daily-pull.yml

1. トリガー
   - `schedule`：日本時間の午前4時。UTC換算で `cron: "0 19 * * *"`
     （既存のGASレコードバックアップが23時に走るため重複を避ける）
   - `workflow_dispatch` も付ける（手動起動用）
2. `permissions: contents: write`
3. `actions/checkout@v4`（`fetch-depth: 0`。タグ操作のため全履歴を取得）
4. `actions/setup-node@v4`（`node-version: 20`）
5. `npm install` は実行しない
6. 実行順序
   1. `node scripts/02_list_apps.js`
   2. `node scripts/03_pull_all.js`
   3. `node scripts/08_pull_app_settings.js`
   4. `git diff --quiet` で差分判定
   5. 差分があれば `自動バックアップ：{YYYY-MM-DD} 変更検知` でコミット・push
   6. 差分がなければコミットせず正常終了
7. タグ付け
   1. 実行日が月初（日付が1日）の場合、`config/apps.json` の `enabled: true` の
      各アプリについて `monthly-{YYYY-MM}-App{appId}` タグを作成し push
   2. 実行日が1月1日の場合、加えて `yearly-{YYYY}-App{appId}` タグも作成し push
   3. タグが既に存在する場合はエラーにせずスキップ
   4. タグ名にアプリ名を含めない（絵文字や記号の混入を避けるため）
8. `env` で Secrets の3つを渡す
   - `KINTONE_BASE_URL` / `KINTONE_USERNAME` / `KINTONE_PASSWORD`
9. `git config` の `user.name` は `irohamie`、`user.email` は `npo@iroha-mie.com`
10. スクリプトが失敗したらワークフローを失敗させる（GitHubからメール通知が届く）

【禁止】deploy 系スクリプトを呼ぶこと
【禁止】古いコミットやタグを削除する処理を入れること

## 前提の確認（あなたがやること）

GitHub Secrets に3つが登録済みかどうかは、あなたからは確認できません。
まーくんに以下を確認してください。

「GitHub の Settings → Secrets and variables → Actions に、
`KINTONE_BASE_URL` / `KINTONE_USERNAME` / `KINTONE_PASSWORD` の3つが
登録済みでしょうか。未登録なら手順をご案内します。」

未登録の場合の案内（ボタン単位）：
1. ブラウザで `https://github.com/irohamie/iroha-kintone` を開く
2. 画面上部のタブから「Settings」をタップ
3. 左メニューを下にスクロールし「Secrets and variables」をタップして展開
4. 「Actions」をタップ
5. 緑色の「New repository secret」ボタンをタップ
6. Name に `KINTONE_BASE_URL`、Secret に `https://iroha-mie.cybozu.com` を入力して
   「Add secret」をタップ
7. 同じ手順で `KINTONE_USERNAME`（値：`github-bot`）と
   `KINTONE_PASSWORD`（値：`.env` に入れたパスワードと同じもの）を登録

## 検証（あなたがやること）

1. ワークフローのYAML構文を確認する（インデントとクォートの誤りがないか）
2. まーくんにワークフローの手動起動を1回だけ依頼し、実行結果を確認する
   - 依頼文：「Actionsタブ →「daily-pull」→「Run workflow」→ 緑の「Run workflow」をタップしてください」
3. 失敗した場合、ログの内容から原因を特定し、あなたが修正して再依頼する
4. 成功したら「初回の自動実行は明日の午前4時です」と報告する

## 最後にやること

1. コミット・push（メッセージ：`Phase 3：毎日の自動バックアップと月次年次タグを追加`）
2. `CLAUDE.md` 9章の進捗表を更新してコミット
3. 「Phase 4 に進んでよいか」をまーくんに確認して停止する
