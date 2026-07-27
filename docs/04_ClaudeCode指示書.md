# Claude Code 指示書

このファイルは、まーくんが Claude Code に貼り付けるための指示文集です。
Phaseごとに用意してあるので、**枠内をそのままコピーして貼り付けてください。**

---

## 事前準備（1回だけ・まーくんの作業）

### A. Claude Code にリポジトリを開かせる

Claude Code を起動し、以下を貼り付けてください。

```
https://github.com/irohamie/iroha-kintone を開いてください。
リポジトリ直下の CLAUDE.md と docs/ の4文書をすべて読み込んでから、
「読み込み完了」と、現在のPhase進捗を報告してください。
まだコードは書かないでください。
```

### B. GitHub Secrets が3つ登録されていることを確認

`docs/02_手順書.md` の 0-4 を実施済みであることを確認してください。

1. ブラウザで `https://github.com/irohamie/iroha-kintone` を開く
2. 画面上部のタブから「Settings」をタップ
3. 左メニューを下にスクロールし「Secrets and variables」をタップして展開
4. 「Actions」をタップ
5. 以下3つが並んでいることを確認する
   - `KINTONE_BASE_URL`
   - `KINTONE_USERNAME`
   - `KINTONE_PASSWORD`

未登録なら、`docs/02_手順書.md` の 0-1 から 0-4 を先に済ませてください。

---

## Phase 0：認証疎通の検証

**このPhaseでkintoneへの書き込みは発生しません。読み取りのみです。**

### Phase 0 指示文（コピーして貼り付け）

```
Phase 0 を実施してください。CLAUDE.md の役割分担のとおり、
あなたはコードを書くだけで、kintone への通信は GitHub Actions が行います。

作成するファイルは以下の3つです。1ファイルずつ、4ブロック分割アペンド方式で
完全版を出力し、各ファイルごとにカスタム検証7項目を実行して報告してください。

────────────────────────
【ファイル1】scripts/lib/kintone.js
────────────────────────
kintone REST API のラッパー。外部パッケージは使わず、Node 20 標準の
fetch / FormData / Blob / node:crypto のみで実装してください。

必須の実装内容：
1. 環境変数 KINTONE_BASE_URL / KINTONE_USERNAME / KINTONE_PASSWORD を読む
   - いずれかが未設定なら、その変数名を明示して即エラー終了する
   - パスワードの値そのものは絶対に出力しない
2. 認証ヘッダの生成
   - X-Cybozu-Authorization: Buffer.from(`${user}:${pass}`).toString('base64')
3. 提供する関数
   - apiGet(path, params)        … クエリ付きGET。JSONを返す
   - apiGetBinary(path, params)  … GET。Buffer（バイト列）を返す（file.json用）
   - apiPost(path, bodyObject)   … JSON POST
   - apiPut(path, bodyObject)    … JSON PUT
   - apiPostFile(buffer, fileName, contentType) … multipart POST。fileKeyを返す
   - md5(buffer)                 … MD5の16進文字列を返す
4. エラー処理
   - HTTPステータスが200番台以外のとき、kintoneが返したJSONの
     code / id / message をそのまま含めた Error を throw する
   - レスポンスがJSONでない場合は、本文の先頭500文字を含めて throw する
   - 絶対に握りつぶさない
5. リトライ
   - HTTP 429 と 5xx のみ、最大3回まで指数バックオフ（1秒→2秒→4秒）で再試行する
   - 4xx（429以外）は再試行せず即エラーにする

────────────────────────
【ファイル2】scripts/01_auth_check.js
────────────────────────
認証方式の実測検証。読み取り専用です。

必須の実装内容：
1. 以下3つを順に実行し、それぞれ成否を日本語で標準出力する
   (1) GET /k/v1/apps.json?limit=1
   (2) GET /k/v1/app/customize.json?app=228
   (3) GET /k/v1/preview/app/customize.json?app=228
2. 成功時は、取得できた内容の要約を表示する
   (1) 総アプリ数（totalCount があればそれ、無ければ取得件数）
   (2) scope、desktop.js の件数、revision
   (3) 同上
3. 失敗時は、kintone が返したエラーコードとメッセージをそのまま表示する
   - 403 やアクセス拒否の文言が出た場合、
     「IPアドレス制限またはセキュアアクセスの可能性があります。
       設計変更が必要なため、まーくんに報告してください」と併記する
4. 3つすべて成功したら終了コード0、1つでも失敗したら終了コード1
5. パスワードを一切出力しない

【禁止】書き込み系API（POST /k/v1/file.json、PUT customize.json、
        POST deploy.json）を呼ぶコードを含めること

────────────────────────
【ファイル3】.github/workflows/auth-check.yml
────────────────────────
Phase 0 を実行するためのワークフロー。

必須の実装内容：
1. トリガーは workflow_dispatch のみ（schedule と push は付けない）
2. runs-on: ubuntu-latest
3. actions/checkout@v4 と actions/setup-node@v4（node-version: 20）を使う
4. npm install は実行しない（依存パッケージゼロのため）
5. node scripts/01_auth_check.js を実行する
6. env で以下を渡す
   KINTONE_BASE_URL: ${{ secrets.KINTONE_BASE_URL }}
   KINTONE_USERNAME: ${{ secrets.KINTONE_USERNAME }}
   KINTONE_PASSWORD: ${{ secrets.KINTONE_PASSWORD }}
7. permissions: contents: read（書き込み不要）

────────────────────────
【最後に】
────────────────────────
1. .env.example を作成する（キー名のみ、実際の値は書かない）
2. 3ファイル＋.env.example を git add し、
   「Phase 0：認証疎通検証スクリプトとワークフローを追加」というメッセージでコミット・push
3. CLAUDE.md の進捗表の Phase 0 を「コード作成済み・実行待ち」に更新してコミット
4. まーくんに、GitHubのActionsタブから auth-check を手動起動する手順を
   ボタン単位で案内する
5. あなたは kintone に直接アクセスしないため、ここで一旦停止し、
   まーくんが実行ログを共有するのを待つこと
```

### Phase 0 の実行（まーくんの作業・スマホから可能）

1. ブラウザで `https://github.com/irohamie/iroha-kintone` を開く
2. 画面上部のタブから「Actions」をタップ
3. 左側の一覧から「auth-check」をタップ
4. 右側に出る「Run workflow」ボタンをタップ
5. Branch が `main` であることを確認し、緑色の「Run workflow」をタップ
6. 20〜30秒待ってからページを再読み込みする
7. 一覧の一番上にある実行結果をタップ
8. 「auth-check」のジョブ名をタップ
9. ログが表示されるので、3つの検証結果を確認する
10. 結果をコピーして Claude Code に貼り付ける

### Phase 0 の判定

| 結果 | 次の行動 |
| --- | --- |
| 3つすべて成功 | Phase 1 へ進む |
| 401 / 認証エラー | ログイン名・パスワードの再確認。Secretsの再登録 |
| 403 / アクセス拒否 | IP制限またはセキュアアクセスの可能性。設計変更が必要なのでまーくんに報告 |
| customize.json のみ失敗 | 対象アプリのアプリ管理権限の付与漏れ。手順書 0-3 を再確認 |

---

## Phase 1：アプリ一覧の自動取得

### Phase 1 指示文（コピーして貼り付け）

```
Phase 0 の認証検証が成功したので、Phase 1 を実施してください。

────────────────────────
【ファイル1】scripts/02_list_apps.js
────────────────────────
必須の実装内容：
1. GET /k/v1/apps.json を limit=100 と offset でページングし、全アプリを取得する
   - 取得件数が limit 未満になったら終了
   - 無限ループ防止のため、最大50回でループを打ち切りエラーとする
2. 既存の config/apps.json があれば読み込み、appId をキーに
   enabled と note の値を必ず引き継ぐ
3. フォルダ名を設計図 5-2 のルールで生成する
   (1) "App" + appId + "_" を先頭に付ける
   (2) アプリ名の先頭の絵文字・記号を除去する
   (3) / \ : * ? " < > | と制御文字を _ に置換する
   (4) 前後の空白を除去、連続空白を _ に置換する
   (5) 結果が空なら App{ID}_noname とする
   (6) 【最重要】リポジトリ内に App{同じID}_ で始まるフォルダが既に存在する場合、
       新しい名前を生成せず、その既存フォルダ名をそのまま folder に書く
       （フォルダのリネームは履歴が断絶するため絶対に行わない）
4. config/apps.json を appId の昇順で書き出す
   形式は設計図 5 のとおり（generatedAt / baseUrl / apps[]）
5. apps.json が存在しない初回のみ、
   appId が 10, 42, 207, 219, 225, 227, 228, 231 のアプリを enabled: true、
   それ以外を enabled: false にする
6. 実行結果として、以下を日本語で表示する
   - 総アプリ数
   - 新規に見つかったアプリの一覧（ID と名前）
   - 前回はあったが今回見つからなかったアプリの一覧
   - enabled: true のアプリ一覧

【禁止】既存の enabled を勝手に書き換えること
【禁止】既存フォルダをリネームまたは削除すること
【禁止】書き込み系APIを呼ぶこと

────────────────────────
【ファイル2】.github/workflows/list-apps.yml
────────────────────────
1. トリガーは workflow_dispatch のみ
2. permissions: contents: write（apps.json をコミットするため）
3. node scripts/02_list_apps.js を実行
4. config/apps.json に差分があれば
   「アプリ一覧更新：{日付}」というメッセージでコミット・push
5. 差分がなければコミットせず正常終了
6. git config の user.name は "irohamie"、user.email は "npo@iroha-mie.com"

────────────────────────
【最後に】
────────────────────────
1. 4ブロック分割アペンド方式で1ファイルずつ完全版を出力し、
   各ファイルごとにカスタム検証7項目を実行して報告する
2. コミット・push する
3. CLAUDE.md の進捗表を更新する
4. まーくんに list-apps ワークフローの手動起動手順を案内し、停止して待つ
```

### Phase 1 実行後の確認（まーくんの作業）

1. GitHubで `config/apps.json` をタップして開く
2. アプリの総数が、kintoneポータルで見えるアプリ数とおおむね一致しているか確認
3. 8アプリの `enabled` が `true` になっているか確認
4. 8アプリの `name` が実際のアプリ名と一致しているか確認
5. `App10_利用希望調査` の `name` が想定と違っていた場合、フォルダ名は変えず `note` にメモを追記するようClaude Codeに依頼する

---

## Phase 2：全コードの初回バックアップ

**このPhaseの完了が、以降すべての書き込み操作の前提条件です。**

### Phase 2 指示文（コピーして貼り付け）

```
Phase 1 が完了したので、Phase 2 を実施してください。
これは以降すべての書き込み操作の前提となる、最も重要なPhaseです。

────────────────────────
【ファイル1】scripts/lib/verify.js
────────────────────────
検証用のユーティリティ。

必須の実装内容：
1. verifySize(buffer, expectedSize, label)
   - buffer.length と Number(expectedSize) を比較
   - 不一致なら「{label}：期待 {expected} バイトに対し実際 {actual} バイト。
     切り詰めの可能性があるため処理を中止します」という Error を throw
2. md5Hex(buffer) … MD5の16進文字列を返す
3. checkJsSyntax(filePath)
   - child_process.execFileSync で node --check を実行
   - 失敗時は stderr を含めた Error を throw
4. formatReportTable(rows)
   - アプリ名・ファイル名・バイト数・MD5・成否 の表を日本語で整形して返す

────────────────────────
【ファイル2】scripts/03_pull_all.js
────────────────────────
必須の実装内容：
1. config/apps.json を読み、enabled: true のアプリのみを対象にループする
2. 各アプリについて GET /k/v1/app/customize.json?app={id}（運用環境）を取得する
3. desktop.js / desktop.css / mobile.js / mobile.css の4配列を、
   【配列の順序を保ったまま】処理する
4. type が "FILE" の項目
   - GET /k/v1/file.json?fileKey={key} で本体を取得
   - verifySize で customize.json の size と実バイト数を突き合わせる
   - 【重要】不一致の場合、そのアプリの処理を中止してエラーとして記録し、
     次のアプリへ進む。無視して先に進んではいけない
   - 保存先は {folder}/desktop/js/{name} のようにスコープ別のパス
   - MD5 を計算する
5. type が "URL" の項目
   - ファイル保存はせず、manifest に url のみ記録する
6. 同一フォルダ内で同名ファイルが2回出た場合
   - {basename}_2{ext} のように連番を付け、manifest に実際のパスを記録する
7. {folder}/manifest.json を設計図 4-2 の形式で書き出す
   - appId / appName / scope / revision / pulledAt
   - desktop.js[] と desktop.css[] と mobile.js[] と mobile.css[]
   - 各要素に order（1始まり）を必ず入れる
   - FILE の要素は path / name / size / md5 を入れる
   - URL の要素は url を入れる
8. 【重要】既にフォルダ内に存在し、今回のcustomize.jsonに含まれないファイルは、
   削除せずそのまま残す。ただし manifest には含めず、
   実行結果に「kintoneに存在しない残存ファイル」として一覧表示する
9. 全アプリの結果を、アプリ名／ファイル名／バイト数／MD5／成否 の表形式で表示する
10. 1つでもエラーがあった場合、終了コード1で終わる（ただし全アプリの処理は試みる）

【禁止】書き込み系APIを呼ぶこと
【禁止】size 不一致を無視して先に進むこと
【禁止】配列の順序を並べ替えること
【禁止】既存ファイルを勝手に削除すること

────────────────────────
【ファイル3】.github/workflows/pull-all.yml
────────────────────────
1. トリガーは workflow_dispatch のみ（Phase 3 で schedule を追加する）
2. permissions: contents: write
3. node scripts/02_list_apps.js を実行
4. node scripts/03_pull_all.js を実行
5. 差分があれば「初回バックアップ：8アプリのJS/CSSを取得（Phase 2）」でコミット・push
6. スクリプトが終了コード1で終わった場合、ワークフローを失敗させる

────────────────────────
【最後に】
────────────────────────
1. 4ブロック分割アペンド方式で1ファイルずつ完全版を出力し、
   各ファイルごとにカスタム検証7項目を実行して報告する
2. コミット・push する
3. CLAUDE.md の進捗表を更新する
4. まーくんに pull-all ワークフローの手動起動手順を案内し、停止して待つ
```

### Phase 2 実行後の目視確認（まーくんの作業・必須）

**ここを飛ばすと、切り詰められたコードに気づかないまま先に進む危険があります。**

1. GitHubで `irohamie/iroha-kintone` を開く
2. 各アプリフォルダを順にタップし、`desktop/js/` の中にJSファイルが入っていることを確認
3. `App228_タイムカード管理/desktop/js/` を開き、ファイルをタップして中身を表示
4. **画面を一番下までスクロールし、末尾が `})();` のように正しく閉じていることを確認**
5. `manifest.json` を開き、`size` が極端に小さくないことを確認
6. Claude Code が報告したバイト数と、GitHub上に表示されるファイルサイズが一致しているか確認

**ファイルが1つも取れていないアプリがあった場合**：そのアプリはURL指定方式（外部CDN参照など）を使っている可能性があります。`manifest.json` の `url` 欄を確認し、Claude Code に `note` への記録を依頼してください。

---

## Phase 3：差分検知の自動化

### Phase 3 指示文（コピーして貼り付け）

```
Phase 2 の初回バックアップと目視確認が完了したので、Phase 3 を実施してください。

────────────────────────
【ファイル】.github/workflows/daily-pull.yml
────────────────────────
必須の実装内容：
1. トリガー
   - schedule: 日本時間の午前4時。UTC換算で cron: "0 19 * * *"
     （既存のGASバックアップが23時に走るため、重複を避ける時刻）
   - workflow_dispatch も付ける（手動起動用）
2. permissions: contents: write
3. actions/checkout@v4（fetch-depth: 0。タグ操作のため全履歴を取得）
4. actions/setup-node@v4（node-version: 20）
5. npm install は実行しない
6. 実行順序
   (1) node scripts/02_list_apps.js
   (2) node scripts/03_pull_all.js
   (3) git diff --quiet で差分判定
   (4) 差分があれば「自動バックアップ：{YYYY-MM-DD} 変更検知」でコミット・push
   (5) 差分がなければコミットせず正常終了
7. タグ付け（設計図 7-7）
   (1) 実行日が月初（日付が1日）の場合、
       config/apps.json の enabled: true の各アプリについて
       monthly-{YYYY-MM}-App{appId} というタグを作成し push する
   (2) 実行日が1月1日の場合、上記に加えて
       yearly-{YYYY}-App{appId} というタグも作成し push する
   (3) タグが既に存在する場合はエラーにせずスキップする
   (4) タグ名にはアプリ名を含めない（絵文字や記号の混入を避けるため）
8. env で Secrets の3つを渡す
9. git config の user.name は "irohamie"、user.email は "npo@iroha-mie.com"
10. スクリプトが失敗したらワークフローを失敗させる（GitHubからメール通知が届く）

【禁止】deploy 系スクリプトを呼ぶこと
【禁止】古いコミットやタグを削除する処理を入れること

────────────────────────
【最後に】
────────────────────────
1. 4ブロック分割アペンド方式で完全版を出力し、カスタム検証7項目を報告
2. コミット・push
3. CLAUDE.md の進捗表を更新
4. まーくんに、翌朝4時の初回自動実行を待つか、
   すぐ手動起動して動作確認するかを尋ねる
```

---

## Phase 4：検証用アプリでのデプロイ手順の確立

**ここから初めてkintoneへの書き込みが発生します。対象は検証用アプリのみです。**

### 事前準備（まーくんの作業）

`docs/02_手順書.md` の 4-1 に従って、kintoneに検証用アプリ `テスト_GitHub連携検証` を作成し、
JSファイルを2つ以上アップロードして、自動化ユーザーにアプリ管理権限を付与してください。
作成後、アプリIDをClaude Codeに伝えてください。

### Phase 4 指示文（コピーして貼り付け）

```
Phase 3 が完了し、検証用アプリ（アプリID：{ここに実際のIDを入れる}）を用意しました。
Phase 4 を実施してください。

【最重要】設計図 7-5 の7つのゲートをすべて実装してください。
1つでもゲートを省略したら、この作業は失敗とみなします。

作成するのは以下4ファイルです。1ファイルずつ完成させ、
4ファイルを同時に進行しないでください。

────────────────────────
【ファイル1】scripts/04_preflight.js
────────────────────────
引数：--app={アプリID}

必須の実装内容：
1. GET /k/v1/app/customize.json?app={id}（運用環境）を取得
2. GET /k/v1/preview/app/customize.json?app={id}（テスト環境）を取得
3. 両者を比較する
   - scope が一致するか
   - 4配列それぞれについて、要素数・順序・type・name・url・size が一致するか
   - fileKey は比較対象に含めない（アップロードごとに変わるため）
4. 完全一致なら「未反映の変更なし。デプロイ可」と表示し終了コード0
5. 不一致なら、差分の内容を日本語で具体的に表示し
   「他者による未反映の変更があるため中止します。
     kintoneのアプリ設定画面を確認してください」と表示して終了コード1

【禁止】書き込み系APIを呼ぶこと

────────────────────────
【ファイル2】scripts/05_snapshot_before.js
────────────────────────
引数：--app={アプリID}

必須の実装内容：
1. 04_preflight.js のロジックを内部で呼び、失敗したら中止する（Gate 1）
2. 運用環境の現行コードを 03_pull_all.js と同じロジックで取得する
   （size検証とMD5計算を必ず含める）
3. _backup_before/{YYYYMMDD}_{folder}/ に保存する
   - manifest.json も含める
   - サブフォルダ構成は本体フォルダと同じ（desktop/js など）
4. 同名フォルダが既に存在する場合は _2 _3 と連番を付ける
   【絶対禁止】既存フォルダを上書き・削除すること
5. git add してコミット・push する
   メッセージ：「デプロイ前退避：{アプリ名}（App{ID}） {YYYY-MM-DD}」
6. 保存パス、ファイル名、バイト数、MD5の一覧を表示する
7. push が失敗した場合は終了コード1で終わる
   （後続のデプロイを絶対に行わせないため）

────────────────────────
【ファイル3】scripts/06_push_preview.js
────────────────────────
引数：--app={アプリID} --source={フォルダパス} [--allow-remove]

必須の実装内容：
1. Gate 1：preflight を内部実行。失敗なら中止
2. Gate 2：_backup_before/ に当日日付のスナップショットが存在するか確認。
   無ければ「デプロイ前退避が未実施です。05_snapshot_before.js を
   先に実行してください」と表示して中止
3. --source の manifest.json を読み、送信ファイル一覧と順序を組み立てる
4. Gate 4：全JSファイルに node --check を実行。1つでも失敗なら中止
5. Gate 3：現行本番のファイル総数と送信ファイル総数を比較。
   送信数が少ない場合、--allow-remove が無ければ
   「ファイル数が {現行} から {送信} に減ります。
     意図的な削除であれば --allow-remove を付けて再実行してください」
   と表示して中止
6. 各ファイルを POST /k/v1/file.json で再アップロードし fileKey を得る
   （既存 fileKey の再利用はしない。CLAUDE.md 5-4 参照）
7. PUT /k/v1/preview/app/customize.json を送信する
   - app / scope / desktop / mobile / revision をすべて明示
   - 4配列すべてを manifest の order どおりに完全列挙する
   - 【禁止】revision に -1 を指定すること
8. Gate 6：GET /k/v1/preview/app/customize.json で再取得し、
   各 FILE を file.json でダウンロードして MD5 を再計算。
   送信前と1つでも不一致なら、エラーを報告して終了コード1
9. 送信前後のファイル名・バイト数・MD5の対照表を表示する
10. 最後に「テスト環境への反映が完了しました。運用環境はまだ変わっていません。
    kintoneのアプリ設定画面で目視確認してください」と表示する

【絶対禁止】deploy.json を呼ぶこと（このスクリプトはテスト環境までで止まる）
【絶対禁止】revision に -1 を指定すること

────────────────────────
【ファイル4】scripts/07_deploy.js
────────────────────────
引数：--app={アプリID} --confirm={アプリID}

必須の実装内容：
1. Gate 5：--confirm の値が --app と完全一致するか確認。
   不一致なら「確認用アプリIDが一致しません」と表示して中止
2. Gate 2：当日の _backup_before/ スナップショットの存在を確認。
   さらに git status で未コミットの変更が無いことを確認。中止条件に含める
3. POST /k/v1/preview/app/deploy.json を送信
   - body: { apps: [{ app: "{id}", revision: "{取得済みrevision}" }] }
   - 【禁止】revision に -1 を指定すること
4. GET /k/v1/preview/app/deploy.json?apps[0].app={id} を
   3秒間隔で最大20回ポーリングし、status が SUCCESS になるまで待つ
   - PROCESSING なら継続
   - FAIL または CANCEL なら即座に内容を表示して終了コード1
   - 20回を超えたらタイムアウトとして報告
5. Gate 7：運用環境 GET /k/v1/app/customize.json を取得し、
   各 FILE をダウンロードして MD5 を再計算。送信前と照合
   - 一致：成功として報告
   - 不一致：「運用環境の内容が想定と一致しません。
     _backup_before/{当日}_{folder}/ を --source に指定して
     06_push_preview.js と 07_deploy.js を再実行すれば元に戻せます」
     と復旧手順を明示して終了コード1
6. _deploy_log/{YYYYMMDD_HHMMSS}_App{ID}.md に以下を追記形式で記録する
   - 実行日時（日本時間）
   - 対象アプリID・アプリ名
   - 送信元フォルダパス
   - 退避先スナップショットのパス
   - 送信前後の全ファイルの名前・バイト数・MD5
   - deploy の status 推移
   - Gate 7 の照合結果
7. _deploy_log/ をコミット・push する
   メッセージ：「デプロイ記録：{アプリ名}（App{ID}） {YYYY-MM-DD HH:MM}」

【絶対禁止】preflight や Gate 2 をスキップすること
【絶対禁止】revision に -1 を指定すること
【絶対禁止】_deploy_log/ の既存ファイルを上書きすること

────────────────────────
【最後に】
────────────────────────
1. 1ファイルずつ4ブロック分割アペンド方式で完全版を出力し、
   各ファイルごとにカスタム検証7項目を実行して報告する
2. 4ファイルすべて完成したら、7つのゲートがどのファイルの
   どの箇所で実装されているかの対応表を作成して報告する
3. コミット・push する
4. CLAUDE.md の進捗表を更新する
5. まーくんに、検証用アプリでのロールバック実地検証
   （手順書 4-8）の手順を案内し、停止して待つ
```

### Phase 4 のロールバック実地検証（最重要・省略禁止）

`docs/02_手順書.md` の 4-8 に従い、以下を**実際に**確認してください。
ここが確認できるまで、本番アプリへのデプロイは行いません。

1. 検証用アプリに、意図的に動作が変わるJSをデプロイする
2. kintoneでアプリを開き、動作が変わったことを確認する
3. `_backup_before/{日付}_{検証用アプリフォルダ}/` を `--source` に指定して
   `06_push_preview.js` を実行する
4. kintoneのアプリ設定画面で、ファイル名と並び順を目視確認する
5. `07_deploy.js` を実行する
6. kintoneでアプリを開き、**元の動作に戻っていることを目で確認する**
7. `_deploy_log/` に2回分の記録が残っていることを確認する

---

## Phase 5：本番デプロイ運用の開始

### 事前準備（まーくんの作業）

`docs/02_手順書.md` の 5-2 に従い、GitHub の Environments に `production` を作成し、
Required reviewers に `irohamie` を設定してください。

1. `https://github.com/irohamie/iroha-kintone` を開く
2. 上部タブの「Settings」をタップ
3. 左メニューの「Environments」をタップ
4. 「New environment」ボタンをタップ
5. Name欄に `production` と入力し「Configure environment」をタップ
6. 「Required reviewers」のチェックボックスをオンにする
7. 現れた入力欄に `irohamie` と入力して選択
8. 「Save protection rules」をタップ

### Phase 5 指示文（コピーして貼り付け）

```
Phase 4 のロールバック実地検証が成功したので、Phase 5 を実施してください。
GitHub Environments の production（Required reviewers: irohamie）も設定済みです。

────────────────────────
【ファイル】.github/workflows/manual-deploy.yml
────────────────────────
必須の実装内容：
1. トリガーは workflow_dispatch のみ
   【絶対禁止】schedule と push トリガーを付けること
2. inputs
   - app_id：対象アプリID（required: true、type: string）
   - confirm：確認用にアプリIDを再入力（required: true、type: string）
   - source：送信元フォルダパス（required: false。空なら本体フォルダを使う）
   - allow_remove：ファイル数が減ることを許可（type: boolean、default: false）
3. ジョブを2つに分ける
   ジョブ1（environment 指定なし）：
     (1) checkout（fetch-depth: 0）
     (2) setup-node（20）
     (3) node scripts/04_preflight.js --app={app_id}
     (4) node scripts/05_snapshot_before.js --app={app_id}
     (5) node scripts/06_push_preview.js --app={app_id} --source={source} [--allow-remove]
     (6) 「kintoneのアプリ設定画面で目視確認してから承認してください」
         というメッセージをジョブサマリに出力する
   ジョブ2（needs: ジョブ1、environment: production）：
     (7) checkout（fetch-depth: 0）
     (8) setup-node（20）
     (9) node scripts/07_deploy.js --app={app_id} --confirm={confirm}
     (10) _deploy_log/ をコミット・push
4. permissions: contents: write
5. env で Secrets の3つを両ジョブに渡す
6. git config の user.name は "irohamie"、user.email は "npo@iroha-mie.com"

【設計意図】ジョブを2つに分け、ジョブ2に environment: production を付けることで、
テスト環境への反映後・運用環境への反映前に、GitHub側で処理が自動停止し、
まーくんの承認タップを待つ状態になります。これが最終確認のゲートです。

────────────────────────
【最後に】
────────────────────────
1. 4ブロック分割アペンド方式で完全版を出力し、カスタム検証7項目を報告
2. コミット・push
3. CLAUDE.md の進捗表を更新
4. まーくんに、最初の本番デプロイ（App231 または App225 を推奨）の
   実行手順をボタン単位で案内し、停止して待つ
```

### Phase 5 の実行（まーくんの作業・スマホから可能）

1. Actionsタブ →「manual-deploy」→「Run workflow」をタップ
2. `app_id` と `confirm` に同じアプリIDを入力
3. `source` は空欄のまま（本体フォルダを使う場合）
4. 「Run workflow」をタップ
5. ジョブ1（preflight・退避・テスト環境反映）が進むのを待つ
6. **kintoneを開き、対象アプリの設定画面でファイル名と並び順を目視確認する**
7. GitHubに戻り、「Review deployments」をタップ
8. `production` にチェックを入れ、「Approve and deploy」をタップ
9. ジョブ2（運用環境への反映）が完了するのを待つ
10. kintoneでアプリを開き、動作を確認する

---

## Phase 6：対象アプリの段階的拡大

### Phase 6 指示文（コピーして貼り付け）

```
Phase 5 が成功したので、Phase 6 を実施してください。

対象を広げるアプリのIDは以下です：
{ここに追加したいアプリIDを列挙する。一度に5アプリ程度までにする}

作業内容：
1. 事前に、まーくんが各アプリで自動化ユーザーに
   アプリ管理権限を付与済みであることを確認する（未確認なら尋ねる）
2. config/apps.json の該当アプリの enabled を false から true に変更する
3. コミット・push する
4. まーくんに pull-all ワークフローの手動起動を依頼する
5. 実行ログを受け取り、以下を報告する
   - 新規に取得できたアプリとファイルの一覧（バイト数・MD5付き）
   - 取得に失敗したアプリとその原因
   - ファイルが1つも取れなかったアプリ（URL指定方式の可能性）
6. 問題があれば原因を特定し、対処案を提示する
7. 問題がなければ CLAUDE.md の進捗表を更新してコミット

【禁止】全アプリを一度に enabled: true にすること
        （エラーの原因切り分けが困難になるため）
【禁止】権限付与の確認をせずに実行を進めること
```

---

## トラブル時の対応表

| 症状 | 想定原因 | 対処 |
| --- | --- | --- |
| 401 Unauthorized | ログイン名・パスワードの誤り | Secretsを再登録。kintone側でパスワード再設定 |
| 403 Forbidden（全API） | IP制限・セキュアアクセス | 設計変更が必要。まーくんに報告 |
| 403 Forbidden（customize.jsonのみ） | アプリ管理権限の付与漏れ、または「アプリを更新」忘れ | 手順書 0-3 の手順9を再実施 |
| ファイルサイズ不一致 | 通信途中での切り詰め | 処理は自動中止される。再実行する |
| preflight で不一致 | 誰かがkintone管理画面で作業中 | その人の作業完了を待つ。または kintone画面の「変更を中止」で破棄 |
| deploy が FAIL | 他の変更との競合、revision不一致 | preflightから やり直す |
| Gate 7 で不一致 | 反映内容が想定と違う | `_backup_before/{当日}_{folder}/` を `--source` に指定してロールバック |
| テスト環境の変更を取り消したい | 反映前に気が変わった | kintoneのアプリ画面右上「変更を中止」をタップ。運用環境は無変更 |

---

## 各Phase完了時のまーくん側チェックリスト

1. GitHubの「Code」タブで、対象ファイルが存在するか
2. ファイルをタップして開き、末尾が正しく閉じているか（`}` や `})();`）
3. Claude Codeが報告したバイト数と、GitHub上の表示サイズが一致しているか
4. 「Commits」タブで、コミットメッセージが日本語で内容を表しているか
5. `_backup_before/` と `_deploy_log/` の中身が減っていないか
6. `CLAUDE.md` の進捗表が更新されているか
