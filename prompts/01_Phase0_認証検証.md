# Phase 0：認証疎通の検証

kintoneへの書き込みは発生しません。読み取りのみです。

## 事前確認

`.env` が存在しない場合、以下をまーくんに依頼してから始めてください。

「kintoneの自動化用ユーザー `github-bot` のパスワードを教えてください。
`.env` に書き込みます。このファイルはGit管理外なのでコミットされません。」

`.env` の形式：
```
KINTONE_BASE_URL=https://iroha-mie.cybozu.com
KINTONE_USERNAME=github-bot
KINTONE_PASSWORD=（提供された値）
```

作成後、`git status` で `.env` がステージされていないことを必ず確認してください。

## 【最優先】Step 0：到達可否の先行確認

**他のすべてに先立って、これを最初に行ってください。**

このチャット（claude.ai）の実行環境からは `iroha-mie.cybozu.com` が
`x-deny-reason: host_not_allowed` で拒否されることが確認済みです。
Claude Code の実行環境でも同じ制限があるかどうかが未検証のため、
まずそこを確かめます。

手順：

1. 以下のワンライナーを実行し、ネットワーク到達性だけを確認する
   （認証情報は使わない。まだ `.env` を作らなくてよい）

   ```
   curl -s -o /dev/null -w "HTTP:%{http_code}\n" -D - --max-time 15 https://iroha-mie.cybozu.com/ | head -20
   ```

2. 結果の判定
   - `x-deny-reason: host_not_allowed` が出た場合
     → **Claude Code からも kintone に届きません。** 直ちに作業を停止し、
       まーくんに「Claude Code の実行環境から kintone に到達できません。
       GitHub Actions を実行主体とする設計に戻す必要があります」と報告する
   - HTTP 200 や 302、またはログイン画面のHTMLが返った場合
     → 到達可能。Step 1 へ進む

3. 到達可能だった場合、`.env` を作成し（下記参照）、
   **アプリ管理権限を必要としない** `GET /k/v1/apps.json?limit=1` だけを
   先に試して、パスワード認証が通ることを確認する

   - 401 が返る → パスワードの誤り。まーくんに再確認を依頼
   - 403 が返る → IP制限やセキュアアクセスの可能性。まーくんに報告して停止
   - 200 が返る → 認証成功。まーくんに以下を報告し、権限付与作業を依頼する

     「kintoneへの接続と認証が成功しました。
       次に、対象8アプリ（10 / 42 / 207 / 219 / 225 / 227 / 228 / 231）で
       `GitHub連携（自動）` にアプリ管理権限を付与してください。
       手順は docs/02_手順書.md の 0-3 にあります。
       各アプリで『保存』のあと『アプリを更新』まで必ず実行してください。」

4. 権限付与の完了報告を受けてから、Step 1 以降に進む

【重要】Step 0 が終わるまで、`customize.json` を叩かないこと。
権限付与前は 403 になるのが正常であり、原因の切り分けが混乱するためです。

---

## Step 1 以降

## 作るファイル1：scripts/lib/env.js

`.env` を読み込むパーサ。`dotenv` は使わない。

- リポジトリ直下の `.env` を読み、`KEY=VALUE` 形式を解析して `process.env` に入れる
- 行頭が `#` の行と空行は無視する
- 値の前後の空白と引用符を除去する
- `.env` が存在しない場合はエラーを投げず、環境変数がすでに設定されている前提で続行する
  （GitHub Actions では Secrets から環境変数が渡されるため）
- `require('./lib/env.js')` するだけで読み込みが完了する形にする

## 作るファイル2：scripts/lib/kintone.js

kintone REST API のラッパー。Node 20標準の fetch / FormData / Blob / node:crypto のみ使用。

必須の実装内容：

1. 先頭で `require('./env.js')` を呼ぶ
2. 環境変数 `KINTONE_BASE_URL` / `KINTONE_USERNAME` / `KINTONE_PASSWORD` を読む
   - いずれか未設定なら、その変数名を明示して即エラー終了する
   - パスワードの値そのものは絶対に出力しない
3. 認証ヘッダ：`X-Cybozu-Authorization: Buffer.from(user + ':' + pass).toString('base64')`
4. 提供する関数
   - `apiGet(path, params)` … クエリ付きGET。JSONを返す
   - `apiGetBinary(path, params)` … GET。Buffer を返す（file.json 用）
   - `apiPost(path, bodyObject)` … JSON POST
   - `apiPut(path, bodyObject)` … JSON PUT
   - `apiDelete(path, bodyObject)` … JSON DELETE
   - `apiPostFile(buffer, fileName, contentType)` … multipart POST。fileKey を返す
   - `md5(buffer)` … MD5の16進文字列
5. エラー処理
   - HTTPステータスが200番台以外のとき、kintoneが返したJSONの `code` / `id` / `message` を
     そのまま含めた Error を throw する
   - レスポンスがJSONでない場合は本文の先頭500文字を含めて throw する
   - 絶対に握りつぶさない
6. リトライ
   - HTTP 429 と 5xx のみ、最大3回まで指数バックオフ（1秒→2秒→4秒）で再試行
   - 429以外の4xx は再試行せず即エラー

## 作るファイル3：scripts/01_auth_check.js

読み取り専用の疎通確認。

1. 以下を順に実行し、それぞれ成否を日本語で標準出力する
   - `GET /k/v1/apps.json?limit=1`
   - `GET /k/v1/app/customize.json?app=228`
   - `GET /k/v1/preview/app/customize.json?app=228`
   - `GET /k/v1/preview/app/form/fields.json?app=228`
2. 成功時は取得内容の要約を表示する（総アプリ数、scope、desktop.js の件数、revision、フィールド数）
3. 失敗時は kintone が返したエラーコードとメッセージをそのまま表示する
   - 403 やアクセス拒否の文言が出た場合、
     「IPアドレス制限またはセキュアアクセスの可能性があります。設計変更が必要です」と併記する
4. 4つすべて成功したら終了コード0、1つでも失敗したら終了コード1
5. パスワードを一切出力しない

【禁止】書き込み系APIを呼ぶコードを含めること

## 実行と検証（あなたがやること）

1. `node scripts/01_auth_check.js` を実行する
2. 出力を読み、成否を判定する
3. 失敗した場合、原因を切り分けて対処する
   - 401 → パスワードの誤り。まーくんに再確認を依頼
   - 403（全API） → IP制限の可能性。まーくんに報告して停止
   - 403（customize.json のみ） → アプリ管理権限の付与漏れ。手順書 0-3 の再実施を依頼
4. 成功するまで、まーくんに作業を投げずにあなたが対処する
5. 成功したら、取得できた内容の要約を日本語で報告する

## 最後にやること

1. `.env.example` を作成する（キー名のみ。実際の値は書かない）
2. `git status` で `.env` が混入していないことを確認する
3. `git add` してコミット・push
   メッセージ：`Phase 0：認証ラッパーと疎通確認スクリプトを追加`
4. `CLAUDE.md` 9章の進捗表の Phase 0 を「完了」に更新してコミット
5. 「Phase 1 に進んでよいか」をまーくんに確認して停止する
