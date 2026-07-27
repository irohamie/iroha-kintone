# Phase 7：新規アプリ作成とフィールド追加・編集

**このPhaseは、アプリの構造そのものを変更します。JS/CSSより危険度が高いため、
CLAUDE.md 7-8 の禁止事項を必ず確認してから着手してください。**

## 許可される操作と禁止される操作

### 自動化してよい操作

| 操作 | API | 危険度 |
| --- | --- | --- |
| 新規アプリの作成 | `POST /k/v1/preview/app.json` | 低（既存を壊さない） |
| フィールドの追加 | `POST /k/v1/preview/app/form/fields.json` | 低（既存データに影響しない） |
| ラベル（`label`）の変更 | `PUT /k/v1/preview/app/form/fields.json` | 低 |
| 選択肢の追加 | `PUT /k/v1/preview/app/form/fields.json` | 低 |
| 必須／初期値の変更 | `PUT /k/v1/preview/app/form/fields.json` | 低 |
| レイアウトの変更・並び替え | `PUT /k/v1/preview/app/form/layout.json` | 低 |
| ビューの追加 | `PUT /k/v1/preview/app/views.json` | 中 |

### 絶対に自動化しない操作（コードを書かないこと）

| 操作 | 禁止理由 |
| --- | --- |
| フィールドの削除 | そのフィールドの全レコードのデータが不可逆に失われる |
| フィールドコード（`code`）の変更 | 既存JS・計算式・ルックアップ・関連レコードが一斉に壊れる |
| フィールドの型（`type`）の変更 | データの変換に失敗して欠損する |
| 選択肢の削除 | 既存レコードの値が選択肢から外れて不整合になる |
| アクセス権の変更（`acl`） | 児童の個人情報が意図せず露出、または業務が停止する |
| アプリの削除 | 不可逆 |
| 既存ビューの削除 | 業務で使われている画面が消える |

これらが必要な場合は、**まーくんがkintone管理画面で手作業で行います。**
あなたは「この操作は自動化の対象外です。kintone管理画面での手順をご案内します」と答え、
ボタン単位の手順を案内してください。

## 削除系操作を依頼された場合の必須対応

まーくんからフィールド削除などを依頼された場合、以下を必ず伝えてください。

「この操作はレコードのデータが不可逆に失われるため、自動化の対象外にしています。
実行前に、既存のGAS＋Googleドライブのレコードバックアップで
対象アプリの当日分バックアップが取得済みであることを確認してください。
その上で、kintone管理画面での手順をご案内します。」

## 作るファイル1：scripts/09_create_app.js

引数：`--name={アプリ名} [--space={スペースID}] [--thread={スレッドID}]`

1. `POST /k/v1/preview/app.json` に `name`（と指定があれば `space` / `thread`）を送信
2. レスポンスから `app`（新アプリID）と `revision` を取得
3. **この時点ではまだフィールドが無い状態でテスト環境に存在するだけ**
4. 新アプリIDを表示し、「フィールド追加後に deploy が必要です」と明示する
5. `config/apps.json` に新アプリを `enabled: true`、`note` に作成日を記録して追記
6. **deploy は自動で行わない。** `10_apply_fields.js` の実行後に別途行う

【禁止】作成と同時に deploy すること（フィールドの無い空アプリが本番に出てしまう）

## 作るファイル2：scripts/09b_snapshot_settings_before.js

引数：`--app={アプリID}`

フィールド変更の前に、現在のアプリ設定を退避する。

1. `08_pull_app_settings.js` と同じロジックで、対象アプリの
   `fields.json` / `layout.json` / `views.json` / `settings.json` / `acl.json` を取得
2. `_backup_before/{YYYYMMDD}_App{ID}_settings/` に保存
3. 同名フォルダが存在する場合は `_2` `_3` と連番。**既存を絶対に上書きしない**
4. `git add` してコミット・push
   メッセージ：`設定変更前退避：{アプリ名}（App{ID}） {YYYY-MM-DD}`
5. push 失敗時は終了コード1（後続の変更を絶対に行わせない）

## 作るファイル3：scripts/10_apply_fields.js

引数：`--app={アプリID} --plan={変更計画JSONのパス} --confirm={アプリID}`

変更計画は人が読める形のJSONファイルとして別途用意し、
そのファイルをリポジトリにコミットしてから適用する方式にする。

変更計画JSONの形式：
```json
{
  "appId": "999",
  "description": "利用希望調査に備考欄を追加",
  "addFields": {
    "bikou": {
      "type": "MULTI_LINE_TEXT",
      "code": "bikou",
      "label": "備考",
      "noLabel": false,
      "required": false
    }
  },
  "updateFields": {
    "既存フィールドコード": { "label": "新しいラベル" }
  }
}
```

必須の実装内容：

1. Gate A：`--confirm` が `--app` と一致するか確認。不一致なら中止
2. Gate B：`_backup_before/{当日}_App{ID}_settings/` が存在するか確認。
   無ければ「設定変更前の退避が未実施です。09b_snapshot_settings_before.js を
   先に実行してください」と表示して中止
3. Gate C：変更計画JSONを検証する。以下が含まれていたら**即座に中止**する
   - `deleteFields` というキー（フィールド削除は禁止）
   - `updateFields` の中の `code` の変更（フィールドコード変更は禁止）
   - `updateFields` の中の `type` の変更（型変更は禁止）
   - `options` から既存の選択肢を減らす変更（選択肢削除は禁止）
   - `acl` に関するキー（アクセス権変更は禁止）
   中止時は「この変更は自動化の対象外です。禁止理由：{該当理由}」と明示する
4. Gate D：運用環境とテスト環境の `fields.json` を比較し、完全一致を確認（preflight）。
   不一致なら他者の未反映変更があるため中止
5. `GET /k/v1/preview/app/form/fields.json` で現在の `revision` を取得
6. `addFields` があれば `POST /k/v1/preview/app/form/fields.json` を送信
   （`app` / `properties` / `revision` を明示）
7. `updateFields` があれば `PUT /k/v1/preview/app/form/fields.json` を送信
   - 【重要】`PUT` は指定したフィールドのみを更新する（`customize.json` とは挙動が異なる）が、
     公式ドキュメントで挙動を必ず確認し、想定と違えば実装を止めてまーくんに報告する
8. Gate E：`GET /k/v1/preview/app/form/fields.json` で再取得し、
   - 追加したフィールドが存在するか
   - **変更計画に含まれていないフィールドが1つも消えていないか**（フィールドコードの集合を比較）
   - 既存フィールドの `type` と `code` が変わっていないか
   を検証する。1つでも異常があれば中止して報告する
9. 【禁止】`revision` に `-1` を指定すること
10. deploy は**このスクリプトでは行わない**。`11_deploy_settings.js` に分離する
11. 変更前後のフィールド一覧（コード／ラベル／型）の対照表を表示する

## 作るファイル4：scripts/11_deploy_settings.js

引数：`--app={アプリID} --confirm={アプリID}`

1. Gate A：`--confirm` が `--app` と一致するか確認
2. Gate B：当日の `_backup_before/{YYYYMMDD}_App{ID}_settings/` の存在を確認
3. Gate F：`git status` で未コミットの変更が無いことを確認
4. `POST /k/v1/preview/app/deploy.json` に `app` と `revision` を明示して送信
5. `GET /k/v1/preview/app/deploy.json?apps[0].app={id}` を3秒間隔で最大20回ポーリング
   - `FAIL` / `CANCEL` なら即座に内容を表示して終了コード1
6. Gate G：運用環境の `fields.json` を取得し、
   - 意図した変更が反映されているか
   - **意図しないフィールドの消失が無いか**（変更前のフィールドコード集合が
     すべて含まれているか。追加のみで減っていないこと）
   を検証する。異常があれば復旧手順を明示して終了コード1
7. `_deploy_log/{YYYYMMDD_HHMMSS}_App{ID}_settings.md` に記録して コミット・push
   - 実行日時／対象／変更計画のパス／退避先パス
   - 変更前後のフィールド一覧
   - deploy の status 推移／Gate G の照合結果

## 設定変更のロールバック手順

フィールド設定は、コードと違って「元のJSONを送り直せば戻る」とは限りません。

- **追加したフィールドを取り消したい場合**：フィールド削除が必要になるため、
  自動化では戻せません。まーくんがkintone管理画面で手作業で削除します。
  ただし追加直後であればそのフィールドにデータは入っていないため、
  削除してもデータ損失は起きません
- **ラベルや選択肢の変更を戻したい場合**：`_backup_before/` の `fields.json` から
  変更前の値を読み、それを `updateFields` として適用すれば戻せます
- **レイアウトを戻したい場合**：`_backup_before/` の `layout.json` を
  そのまま `PUT /k/v1/preview/app/form/layout.json` に送れば戻せます

【重要】この非対称性（追加は自動でできるが取り消しは手作業）を、
まーくんに必ず事前説明してから実行してください。

## 検証（あなたがやること）

Phase 4 と同様に、**まず検証用アプリで一通り試してから**本番アプリに適用してください。

1. `09_create_app.js` で検証用の新アプリを作成する
2. `10_apply_fields.js` でフィールドを2つ追加する
3. `11_deploy_settings.js` で反映する
4. kintoneでアプリを開き、フィールドが追加されていることをまーくんに目視確認してもらう
5. Gate C の故意破壊テストを行う
   - `deleteFields` を含む変更計画JSONを作って実行 → 中止されるか
   - `code` を変更する変更計画JSONを作って実行 → 中止されるか
   - `type` を変更する変更計画JSONを作って実行 → 中止されるか
   （テスト用JSONは検証後に削除し、`git status` をきれいにすること）
6. Gate E / Gate G のフィールド消失検知が働くことを確認する
7. 結果を報告する

## 最後にやること

1. コミット・push（メッセージ：`Phase 7：アプリ作成とフィールド追加編集を追加`）
2. `CLAUDE.md` 9章の進捗表を更新してコミット
3. 検証結果と、禁止操作の一覧をまーくんに報告して停止する
