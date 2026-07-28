# Phase 0：認証疎通の検証（確定版・GitHub Actions実行方式）

## 確定した前提

Claude Code の実行環境から kintone（iroha-mie.cybozu.com）へは到達できないことを
実測で確認済みです（2026年7月28日）。egressポリシーによりCONNECT自体が拒否されます。

そのため、**kintoneへの実通信はすべてGitHub Actionsのランナーが行います。**
あなたはコードを書き、GitHub Actions を自分で起動・監視し、ログを取得して
解析する役割を担います。まーくんにActionsタブでの手動操作を依頼しないでください。

## 事前確認（あなたがやること）

1. GitHub Secrets に3つが登録済みか確認する。確認方法：
   `GET /repos/irohamie/iroha-kintone/actions/secrets` で名前一覧が取れる
   （値は取得できないが、存在確認はできる）
2. `KINTONE_BASE_URL` / `KINTONE_USERNAME` / `KINTONE_PASSWORD` の3つが
   無ければ、まーくんに以下を依頼する

   「GitHub の Settings → Secrets and variables → Actions で、
   以下3つを登録してください。
   1. Name: KINTONE_BASE_URL / Secret: https://iroha-mie.cybozu.com
   2. Name: KINTONE_USERNAME / Secret: github-bot
   3. Name: KINTONE_PASSWORD / Secret: （先ほど設定したパスワード）」

## 作るファイル1：scripts/lib/kintone.js

kintone REST API のラッパー。Node 20標準の fetch / FormData / Blob / node:crypto のみ使用。
GitHub Actions のランナー上で実行される前提で書く（`.env` は読まない。
環境変数は Actions の `env:` から直接渡される）。

必須の実装内容：

1. 環境変数 `KINTONE_BASE_URL` / `KINTONE_USERNAME` / `KINTONE_PASSWORD` を読む
   - いずれか未設定なら、その変数名を明示して即エラー終了する
   - パスワードの値そのものは絶対に出力しない
2. 認証ヘッダ：`X-Cybozu-Authorization: Buffer.from(user + ':' + pass).toString('base64')`
3. 提供する関数
   - `apiGet(path, params)` … クエリ付きGET。JSONを返す
   - `apiGetBinary(path, params)` … GET。Buffer を返す（file.json 用）
   - `apiPost(path, bodyObject)` … JSON POST
   - `apiPut(path, bodyObject)` … JSON PUT
   - `apiDelete(path, bodyObject)` … JSON DELETE
   - `apiPostFile(buffer, fileName, contentType)` … multipart POST。fileKey を返す
   - `md5(buffer)` … MD5の16進文字列
4. エラー処理
   - HTTPステータスが200番台以外のとき、kintoneが返したJSONの `code` / `id` / `message` を
     そのまま含めた Error を throw する
   - レスポンスがJSONでない場合は本文の先頭500文字を含めて throw する
   - 絶対に握りつぶさない
5. リトライ
   - HTTP 429 と 5xx のみ、最大3回まで指数バックオフ（1秒→2秒→4秒）で再試行
   - 429以外の4xx は再試行せず即エラー

## 作るファイル2：scripts/01_auth_check.js

読み取り専用の疎通確認。

1. 以下を順に実行し、それぞれ成否を日本語で標準出力する
   - `GET /k/v1/apps.json?limit=1`
   - `GET /k/v1/app/customize.json?app=228`
   - `GET /k/v1/preview/app/customize.json?app=228`
   - `GET /k/v1/preview/app/form/fields.json?app=228`
2. 成功時は取得内容の要約を表示する（総アプリ数、scope、desktop.js の件数、revision、フィールド数）
3. 失敗時は kintone が返したエラーコードとメッセージをそのまま表示する
   - 403 やアクセス拒否の文言が出た場合、
     「IPアドレス制限またはセキュアアクセスの可能性があります」と併記する
4. 4つすべて成功したら終了コード0、1つでも失敗したら終了コード1
5. パスワードを一切出力しない

【禁止】書き込み系APIを呼ぶコードを含めること

## 作るファイル3：.github/workflows/auth-check.yml

1. トリガーは `workflow_dispatch` のみ
2. `runs-on: ubuntu-latest`
3. `actions/checkout@v4` と `actions/setup-node@v4`（`node-version: 20`）
4. `npm install` は実行しない
5. `node scripts/01_auth_check.js` を実行
6. `env` で以下を渡す
   ```
   KINTONE_BASE_URL: ${{ secrets.KINTONE_BASE_URL }}
   KINTONE_USERNAME: ${{ secrets.KINTONE_USERNAME }}
   KINTONE_PASSWORD: ${{ secrets.KINTONE_PASSWORD }}
   ```
7. `permissions: contents: read`（書き込み不要）

## 実行と検証（あなたがやること・まーくんに手動起動を依頼しない）

1. 3ファイルをコミット・push する
2. GitHub API で `auth-check.yml` に `workflow_dispatch` を送って起動する
   ```
   POST /repos/irohamie/iroha-kintone/actions/workflows/auth-check.yml/dispatches
   body: { "ref": "main" }
   ```
3. `GET /repos/irohamie/iroha-kintone/actions/runs?event=workflow_dispatch&per_page=1` を
   数秒間隔でポーリングし、起動した実行を特定する
4. `status` が `completed` になるまで待つ（`in_progress` の間は待機）
5. `GET /repos/irohamie/iroha-kintone/actions/runs/{run_id}/jobs` でジョブ結果を取得
6. `conclusion` が `failure` の場合、
   `GET /repos/irohamie/iroha-kintone/actions/jobs/{job_id}/logs` でログ本文を取得し、
   4つの検証のうちどこで失敗したかを特定する
7. 失敗原因ごとの対処
   - 401 → パスワードの誤り。まーくんに再確認を依頼
   - 403（全API） → IP制限の可能性。まーくんに報告して停止
   - 403（customize.jsonのみ） → アプリ管理権限の付与漏れ、または「アプリを更新」忘れ。
     手順書 0-3 の再実施を依頼
8. 成功するまで、あなたが原因を切り分けて対処する（まーくんに調査を投げない）
9. 成功したら、取得できた内容の要約を日本語で報告する

## 最後にやること

1. `CLAUDE.md` 9章の進捗表の Phase 0 を「完了」に更新してコミット
2. 「Phase 1 に進んでよいか」をまーくんに確認して停止する
