# CLAUDE.md

このファイルは Claude Code が毎セッション自動で読み込む永続指示です。
作業を始める前に、必ずこのファイル全体と `docs/` の4文書を読んでください。

---

## 1. このリポジトリの目的

NPO法人いろ葉（三重県、児童発達支援事業所）が運用する kintone（`iroha-mie.cybozu.com`）の
JS/CSSカスタマイズコードを、Gitで版管理するためのリポジトリです。

管理者：齋藤眞寛（まーくん）／代表理事
主な操作端末：iPad、Androidスマートフォン（PCは常用しない）

## 2. 必ず読む文書

| ファイル | 内容 |
| --- | --- |
| `docs/01_設計図.md` | 構造・認証方式・安全性設計・7つのデプロイゲート・禁止事項 |
| `docs/02_手順書.md` | Phase 0〜6の実作業手順 |
| `docs/03_Sonnet指示テンプレート.md` | コード生成規約とPhase別指示文 |
| `docs/04_ClaudeCode指示書.md` | Claude Code専用の作業指示（Phase別） |

矛盾を見つけた場合は、実装を進めず、文書の更新を提案してください。

---

## 3. 役割分担（最重要の設計判断）

**Claude Code は kintone に直接通信しません。**

| 担い手 | 役割 | kintone資格情報 |
| --- | --- | --- |
| Claude Code | コードを書く、構文検証する、コミット・pushする | 持たない |
| GitHub Actions | 書かれたコードを実行して kintone と通信する | GitHub Secretsから取得 |
| まーくん | 実行トリガー、目視確認、デプロイ承認 | kintone管理画面で操作 |

理由：
1. 資格情報がClaude Codeのセッション履歴やログに残る経路を構造的に消す
2. まーくんの端末がiPad/Androidであり、ローカル実行環境が安定して確保できない
3. GitHub Secretsが唯一の資格情報保管場所になり、漏洩時の対処が1箇所で済む

【禁止】Claude Codeが `.env` に実際のkintoneパスワードを書くこと。
【禁止】Claude Codeがkintone APIへ直接リクエストを送ること。
【必須】動作確認は、GitHub Actionsのワークフローをまーくんに手動起動してもらい、そのログを読んで判断すること。

---

## 4. 技術スタックの制約

| 項目 | 決定 | 理由 |
| --- | --- | --- |
| 言語 | Node.js（CommonJS、`require`形式） | GitHub Actionsで追加設定なく動く |
| Nodeバージョン | 20以上 | `fetch` / `FormData` / `Blob` が標準搭載され、外部パッケージが不要 |
| 外部依存パッケージ | **ゼロ**。`package.json` も作らない | サプライチェーンリスクの排除、GitHub Actionsの高速化 |
| HTTP通信 | 標準の `fetch` | 同上 |
| multipart送信 | 標準の `FormData` + `Blob` | `form-data` パッケージ不要 |
| MD5計算 | `require('node:crypto').createHash('md5')` | 標準機能 |
| 構文検証 | `node --check <path>` | 標準機能 |

【禁止】`npm install` を実行すること。`axios`、`node-fetch`、`form-data`、`@kintone/rest-api-client` などを使うこと。

---

## 5. kintone REST API の仕様（実装前に必ず検証すること）

以下は設計時点での理解です。**推測を含むため、実装前に公式ドキュメント（https://cybozu.dev/ja/kintone/docs/rest-api/ ）を参照して裏を取り、差異があれば `docs/01_設計図.md` を先に更新してください。**

### 5-1. 認証

```
X-Cybozu-Authorization: <base64("ログイン名:パスワード")>
```

アプリ設定API（`customize.json`、`deploy.json`、`apps.json`）はAPIトークン認証が使えないため、上記のパスワード認証を使います。

### 5-2. 使用するエンドポイント

| 用途 | メソッド・パス | 危険度 |
| --- | --- | --- |
| アプリ一覧 | `GET /k/v1/apps.json?limit=100&offset=0` | 安全 |
| 運用環境のカスタマイズ設定 | `GET /k/v1/app/customize.json?app={id}` | 安全 |
| テスト環境のカスタマイズ設定 | `GET /k/v1/preview/app/customize.json?app={id}` | 安全 |
| ファイル本体の取得 | `GET /k/v1/file.json?fileKey={key}` | 安全 |
| ファイルのアップロード | `POST /k/v1/file.json`（multipart、フィールド名 `file`） | 設定に影響しない |
| テスト環境の設定更新 | `PUT /k/v1/preview/app/customize.json` | テスト環境のみ変更 |
| 運用環境への反映 | `POST /k/v1/preview/app/deploy.json` | **本番が変わる** |
| 反映状況の確認 | `GET /k/v1/preview/app/deploy.json?apps[0].app={id}` | 安全 |

### 5-3. customize.json のレスポンス構造（想定）

```json
{
  "scope": "ALL",
  "desktop": {
    "js": [
      { "type": "URL", "url": "https://..." },
      { "type": "FILE", "file": { "fileKey": "...", "name": "board.js", "contentType": "text/javascript", "size": "137216" } }
    ],
    "css": []
  },
  "mobile": { "js": [], "css": [] },
  "revision": "12"
}
```

注意点：
- `size` は**文字列**で返る。数値比較する際は必ず変換すること
- `scope` は `ALL` / `ADMIN` / `NONE` のいずれか
- 配列の順序がJSの実行順序である。**順序を絶対に変えないこと**

### 5-4. fileKey の扱いについての判断

`customize.json` のGETで返る `fileKey` を、そのまま `PUT` に再利用できるかは**不確実**です。
そのため、**再利用せず、常にローカルのファイルを `POST /k/v1/file.json` で再アップロードして新しい fileKey を得る方式**を採用します。

理由：バイト列がローカルにあるため常に再アップロード可能であり、挙動が決定的になる。内容が同一でも再アップロードは無害。

---

## 6. 安全性の絶対ルール

### 6-1. Phase順序の厳守

**Phase 2（初回バックアップ）が完了しコミットされるまで、kintoneへの書き込み系API（`POST /k/v1/file.json`、`PUT .../customize.json`、`POST .../deploy.json`）を呼ぶコードを一切実行してはいけません。**

kintoneにはJSカスタマイズの「前のバージョンに戻す」機能がありません。バックアップがない状態での書き込みは、取り返しのつかない事故になります。

### 6-2. PUT は全置き換えである

`PUT /k/v1/preview/app/customize.json` は部分更新ではなく全置き換えです。
3ファイル登録されているアプリに1ファイルだけ送ると、残り2つは警告なしに消えます。

【必須】PUTでは `desktop.js` / `desktop.css` / `mobile.js` / `mobile.css` の4配列すべてを、`manifest.json` の順序どおりに完全に列挙すること。

### 6-3. revision による楽観ロック

【必須】PUTとdeployには常に取得済みの `revision` を明示指定すること。
【禁止】`revision: -1`（チェック無効）を指定すること。

### 6-4. preflight の省略禁止

デプロイ系スクリプトは、先頭で必ず「運用環境とテスト環境が完全一致していること」を確認します。
一致しない場合は他者の未反映変更が存在するため、**処理を中止して報告**します。

### 6-5. サイズとMD5による検証（過去の事故対策）

過去に `board.js` が 137KB → 118KB に切り詰められた事故があります。

【必須】
1. ダウンロード時、`customize.json` の `size` と実バイト数を突き合わせる。不一致なら処理中止
2. 全ファイルのMD5を `manifest.json` に記録する
3. アップロード後、**取得し直して**MD5を再計算し、送信前と一致することを確認する
4. 人への報告時は必ずファイル名・バイト数・MD5を明記する

### 6-6. 削除禁止ディレクトリ

`_backup_before/` と `_deploy_log/` は追記専用です。中身の削除・上書きを絶対に行わないこと。

### 6-7. バックアップの保持方針

古いバックアップの削除ローテーションは**行いません**。Gitの全履歴を無期限に保持します。
月初・年初には `monthly-{YYYY-MM}-App{ID}` / `yearly-{YYYY}-App{ID}` のタグを自動付与します。

---

## 7. コード生成規約（まーくんの標準ルール）

### 7-1. 完全版出力

- コードは常に**完全版・省略なし**で出力する
- 「（以下省略）」「（変更なし）」「// 既存のコードはそのまま」は禁止
- 一部修正でも、そのファイル全体を最初から最後まで出力する
- 指示された箇所以外の既存コードを要約・短縮・削除しない

### 7-2. 4ブロック分割アペンド方式

1回の書き込みで巨大なコードを出すと途中で切れるため、以下を必ず踏む。

```bash
cat > scripts/03_pull_all.js << 'BLOCK1_EOF'
（ブロック1）
BLOCK1_EOF

cat >> scripts/03_pull_all.js << 'BLOCK2_EOF'
（ブロック2）
BLOCK2_EOF

cat >> scripts/03_pull_all.js << 'BLOCK3_EOF'
（ブロック3）
BLOCK3_EOF

cat >> scripts/03_pull_all.js << 'BLOCK4_EOF'
（ブロック4）
BLOCK4_EOF

node --check scripts/03_pull_all.js && echo "構文OK"
wc -c scripts/03_pull_all.js
md5sum scripts/03_pull_all.js
tail -5 scripts/03_pull_all.js
```

1ファイルずつ完成させること。複数ファイルを同時進行しないこと。

### 7-3. カスタム検証（生成後に必ず実行し、結果を報告）

| # | 検証内容 | 方法 |
| --- | --- | --- |
| 1 | 構文が正しい | `node --check` が成功 |
| 2 | 省略表記の混入なし | `grep -nE '以下省略\|変更なし\|省略\|TODO\|FIXME\|\.\.\.'` が0件 |
| 3 | 関数の欠落なし | 定義した関数名を `grep -c` で数え、宣言と呼び出しの対応を確認 |
| 4 | 切り詰めなし | `wc -c` のバイト数と `tail -5` の末尾を表示し、閉じ括弧を確認 |
| 5 | 禁止APIの混入なし | `deploy.json` を呼ぶ箇所が `07_deploy.js` 以外に0件 |
| 6 | revision の扱い | `revision` に `-1` を渡す箇所が0件 |
| 7 | 資格情報の漏洩なし | `console.log` の引数に `password` `PASSWORD` `token` を含む箇所が0件 |

報告形式：

```
【検証結果】scripts/03_pull_all.js
1 構文チェック：OK
2 省略表記の混入：0件
3 定義関数：8個（すべて呼び出しあり）
4 ファイルサイズ：14,208 バイト ／ 末尾3行：（表示）
5 禁止API混入：なし
6 revision: -1 の使用：0件
7 資格情報の出力：なし
MD5：a1b2c3...
```

### 7-4. 説明とコミュニケーション

- 説明は超丁寧に、ボタンひとつまで詳しく書く
- 画面上の位置と操作を明記する（「画面右上の歯車マークをタップ」など）
- 出力が長くなる場合は複数回に分ける。回数をケチらない
- 謝罪は不要。欠陥を悔いる必要もない。訂正は事実と修正案のみ述べる
- ❌マークは使わない
- 日本語で応答する

### 7-5. GitHubへのファイル投入方法

【禁止】GitHubのWeb UIのドラッグ＆ドロップでファイルを投入すること。過去に関数が消失する事故がありました。
【必須】必ず `git add` → `git commit` → `git push` のコマンド経由で行うこと。

コミットメッセージは日本語で「どのアプリの、何を、なぜ変更したか」を書くこと。

---

## 8. 判断に迷ったときの原則

1. **迷ったら止める。** 書き込み系で判断がつかないときは実行せず、まーくんに質問する
2. **推測でAPIを叩かない。** 仕様が不明なAPIは公式ドキュメントで確認する
3. **設計図と矛盾する実装をしそうになったら、実装ではなく設計図の更新を提案する**
4. **エラーを飲み込まない。** try-catchで握りつぶさず、必ず内容を表示して処理を止める
5. **「動いたからよし」としない。** バイト数とMD5で裏を取るまで完了と報告しない
6. **勝手にPhaseを先に進めない。** 1つのPhaseが終わったら報告し、次の指示を待つ

---

## 9. 現在の進捗

| Phase | 状態 |
| --- | --- |
| 初期構築（フォルダ・文書） | 完了（2026年7月28日） |
| Phase 0：認証検証 | 未着手 |
| Phase 1：アプリ一覧取得 | 未着手 |
| Phase 2：初回バックアップ | 未着手 |
| Phase 3：差分検知の自動化 | 未着手 |
| Phase 4：デプロイ手順の確立 | 未着手 |
| Phase 5：本番デプロイ運用 | 未着手 |
| Phase 6：対象アプリ拡大 | 未着手 |

Phaseを完了したら、この表を更新してコミットしてください。
