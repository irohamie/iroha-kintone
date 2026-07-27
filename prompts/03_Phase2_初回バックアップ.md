# Phase 2：初回バックアップ（コード＋アプリ設定）

**このPhaseの完了が、以降すべての書き込み操作の前提条件です。**
kintoneへの書き込みは発生しません。読み取りのみです。

## 作るファイル1：scripts/lib/verify.js

1. `verifySize(buffer, expectedSize, label)`
   - `buffer.length` と `Number(expectedSize)` を比較
   - 不一致なら「{label}：期待 {expected} バイトに対し実際 {actual} バイト。
     切り詰めの可能性があるため処理を中止します」という Error を throw
2. `md5Hex(buffer)` … MD5の16進文字列を返す
3. `checkJsSyntax(filePath)`
   - `child_process.execFileSync` で `node --check` を実行
   - 失敗時は stderr を含めた Error を throw
4. `formatTable(headers, rows)`
   - 日本語の表を整形して返す（報告用）

## 作るファイル2：scripts/03_pull_all.js

JS/CSSコードの取得。

1. `config/apps.json` を読み、`enabled: true` のアプリのみを対象にループする
2. 各アプリについて `GET /k/v1/app/customize.json?app={id}`（運用環境）を取得
3. `desktop.js` / `desktop.css` / `mobile.js` / `mobile.css` の4配列を、
   **配列の順序を保ったまま**処理する
4. `type` が `"FILE"` の項目
   - `GET /k/v1/file.json?fileKey={key}` で本体を取得
   - `verifySize` で `size` と実バイト数を突き合わせる
   - **不一致の場合、そのアプリの処理を中止してエラー記録し、次のアプリへ進む。
     無視して先に進んではいけない**
   - 保存先は `{folder}/desktop/js/{name}` のようにスコープ別のパス
   - MD5 を計算する
5. `type` が `"URL"` の項目はファイル保存せず、manifest に `url` のみ記録する
6. 同一フォルダ内で同名ファイルが2回出た場合は `{basename}_2{ext}` と連番を付け、
   manifest に実際のパスを記録する
7. `{folder}/manifest.json` を書き出す
   - `appId` / `appName` / `scope` / `revision` / `pulledAt`
   - `desktop.js[]` `desktop.css[]` `mobile.js[]` `mobile.css[]`
   - 各要素に `order`（1始まり）を必ず入れる
   - FILE の要素は `path` / `name` / `size` / `md5`
   - URL の要素は `url`
8. 既にフォルダ内に存在し今回のcustomize.jsonに含まれないファイルは、
   削除せずそのまま残す。ただし manifest には含めず、
   実行結果に「kintoneに存在しない残存ファイル」として一覧表示する
9. 全アプリの結果を「アプリ名／ファイル名／バイト数／MD5／成否」の表形式で表示する
10. 1つでもエラーがあれば終了コード1（ただし全アプリの処理は試みる）

【禁止】書き込み系APIを呼ぶこと
【禁止】size 不一致を無視して先に進むこと
【禁止】配列の順序を並べ替えること
【禁止】既存ファイルを勝手に削除すること

## 作るファイル3：scripts/08_pull_app_settings.js

アプリ設定（フィールド・レイアウト・ビュー・一般設定・アクセス権）の取得。読み取り専用。

1. `config/apps.json` の `enabled: true` のアプリを対象にループする
2. 各アプリについて以下を取得し、`{folder}/settings/` 配下にJSONで保存する
   - `GET /k/v1/preview/app/form/fields.json?app={id}` → `settings/fields.json`
   - `GET /k/v1/preview/app/form/layout.json?app={id}` → `settings/layout.json`
   - `GET /k/v1/preview/app/views.json?app={id}` → `settings/views.json`
   - `GET /k/v1/preview/app/settings.json?app={id}` → `settings/settings.json`
   - `GET /k/v1/preview/app/acl.json?app={id}` → `settings/acl.json`
3. JSONは差分が読みやすいよう、**キーをアルファベット順にソートして
   インデント2でpretty-print**する（毎回キー順が変わると差分が汚れるため）
4. 取得に失敗したアプリはエラー記録して次へ進む
   （アクセス権の取得は権限によって失敗しうるため、失敗しても全体は止めない）
5. 各アプリのフィールド数・ビュー数を表形式で報告する

【禁止】書き込み系APIを呼ぶこと
【禁止】取得したJSONを整形以外の目的で書き換えること

## 実行と検証（あなたがやること）

1. `node scripts/03_pull_all.js` を実行する
2. `node scripts/08_pull_app_settings.js` を実行する
3. **自分で以下を検証する**
   - 各アプリフォルダにJSファイルが存在するか
   - 各JSファイルの末尾が正しく閉じているか（`tail -3` で確認し、`})();` や `}` で終わるか）
   - `node --check` が全JSファイルで成功するか
   - `manifest.json` の `size` と実ファイルの `wc -c` が一致するか
   - `settings/fields.json` にフィールド定義が入っているか
4. ファイルが1つも取れなかったアプリがあれば、
   manifest の `url` 欄を確認してURL指定方式かどうか判定し、`note` に記録する
5. 検証結果を「アプリ名／ファイル数／総バイト数／構文チェック／末尾確認／フィールド数」の
   表形式で報告する

## 最後にやること

1. `git status` で `.env` が混入していないことを確認
2. コミット・push
   メッセージ：`Phase 2：初回バックアップ（8アプリのJS/CSSとアプリ設定）`
3. `CLAUDE.md` 9章の進捗表を更新してコミット
4. 「Phase 3 に進んでよいか」をまーくんに確認して停止する
