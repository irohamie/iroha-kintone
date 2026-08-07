/*
 * =====================================================================
 * app207_field_copy.js
 * アプリ207「支援計画」フィールドコピー機能（設計書v2準拠）
 * ---------------------------------------------------------------------
 * 機能概要:
 *   ・レコード詳細画面のスペース(要素ID: move1=前期近く／move2=後期近く)に
 *     それぞれ2つのボタンを設置
 *       [他レコードから計画をコピー] 氏名+生年月日が一致する別レコードから
 *                              前期/後期セット(各34項目)のうち選択した項目を
 *                              このレコードの対応するセットへ上書きコピー
 *                              (move1=前期セットへ固定／move2=後期セットへ固定)
 *       [計画をコピー前に戻す]  コピー直前の状態(テキスト+添付ファイル実体)を
 *                              IndexedDBのバックアップから復元
 *                              (LIFO / 1レコード×1セットあたり最大5件 / 保持7日)
 *   ・添付ファイルは ダウンロード→アップロード→新fileKey で実体複製
 *   ・レコード更新は revision 指定(楽観ロック)
 *   ・PC(app.record.detail.show) / モバイル(mobile.app.record.detail.show) 両対応
 * 導入:
 *   アプリ設定 > カスタマイズ/サービス連携 > JavaScript/CSSでカスタマイズ >
 *   「PC用」「スマートフォン用」の両方に本ファイルを登録
 * =====================================================================
 */
(() => {
  'use strict';

  // ==========================================================
  // 【ブロック1】CONFIG・フィールド定義・メッセージ・ユーティリティ
  // ==========================================================

  const CONFIG = {
    SPACE_ID_ZENKI: 'move1',                   // 前期フィールド近くのスペース(コピー先=前期セット固定)
    SPACE_ID_KOUKI: 'move2',                   // 後期フィールド近くのスペース(コピー先=後期セット固定)
    FIELD_NAME: '氏名',                        // ルックアップ(照合キー1)
    FIELD_BIRTH: '生年月日',                   // 日付(照合キー2)
    FIELD_ZENKI_DATE: '前期計画開始',          // 一覧表示・並び替えキー
    FIELD_KOUKI_DATE: '後期計画開始',          // 一覧表示(参考)
    CANDIDATE_LIMIT: 500,                      // コピー元候補の取得上限
    SNAPSHOT_DB_NAME: 'iroha_app207_copy_undo',
    SNAPSHOT_DB_VERSION: 1,
    SNAPSHOT_STORE: 'snapshots',
    SNAPSHOT_MAX_PER_RECORD: 5,                // 1レコード×1セット(前期/後期)あたりの履歴保持数
    SNAPSHOT_TTL_DAYS: 7                       // 履歴の保持日数
  };

  const LABEL_COPY_BTN_ZENKI = '他レコードから計画をコピー';
  const LABEL_COPY_BTN_KOUKI = '他レコードから計画をコピー';
  const LABEL_UNDO_BASE_ZENKI = '計画をコピー前に戻す';
  const LABEL_UNDO_BASE_KOUKI = '計画をコピー前に戻す';

  // ---- セット定義(設計書6.1の表と同じ並び順・行単位で1対1対応) ----
  const SET_DEF = {
    zenki: {
      key: 'zenki',
      label: '前期セット',
      textFields: [
        '課題1', 'ねらい1', '内容1', '評価1', '変更1',
        '課題2', 'ねらい2', '内容2', '評価2', '変更2',
        '課題3', 'ねらい3', '内容3', '評価3', '変更3',
        '課題4', 'ねらい4', '内容4', '評価4', '変更4',
        '課題5', 'ねらい5', '内容5', '評価5', '変更5',
        '前期短期目標'
      ],
      fileFields: [
        '前期案', '前期評価案', '前期計画', '前期評価',
        '前期サイン済', '前期評価サイン済', '前期立案署名', '前期評価署名'
      ]
    },
    kouki: {
      key: 'kouki',
      label: '後期セット',
      textFields: [
        '課題6', 'ねらい6', '内容6', '評価6', '変更6',
        '課題7', 'ねらい7', '内容7', '評価7', '変更7',
        '課題8', 'ねらい8', '内容8', '評価8', '変更8',
        '課題9', 'ねらい9', '内容9', '評価9', '変更9',
        '課題10', 'ねらい10', '内容10', '評価10', '変更10',
        '後期短期目標'
      ],
      fileFields: [
        '後期案', '後期評価案', '後期計画', '後期評価',
        '後期サイン済', '後期評価サイン済', '後期立案署名', '後期評価署名'
      ]
    }
  };

  // ---- コピー方向(D1〜D4) ----
  // label(静的な説明文)は持たず、実際の日付を差し込んだ動的ラベルを
  // directionLabel()で都度生成する(下記ユーティリティ参照)。
  const DIRECTIONS = [
    {
      id: 'D1', from: 'zenki', to: 'zenki',
      note: ''
    },
    {
      id: 'D2', from: 'kouki', to: 'kouki',
      note: ''
    },
    {
      id: 'D3', from: 'zenki', to: 'kouki',
      note: ''
    },
    {
      id: 'D4', from: 'kouki', to: 'zenki',
      note: ''
    }
  ];

  // ---- STEP1の候補一覧に表示する添付ファイル項目(表示専用) ----
  // 立案署名・評価署名は一覧に表示しない(実際のコピー対象34項目には引き続き含まれる)
  // 表示順: 案 → 計画 → サイン済 → 評価案 → 評価 → 評価サイン済
  const STEP1_FILE_SHORT_LABELS = ['案', '計画', 'サイン済', '評価案', '評価', '評価サイン済'];
  const STEP1_ZENKI_FILE_FIELDS = ['前期案', '前期計画', '前期サイン済', '前期評価案', '前期評価', '前期評価サイン済'];
  const STEP1_KOUKI_FILE_FIELDS = ['後期案', '後期計画', '後期サイン済', '後期評価案', '後期評価', '後期評価サイン済'];

  // ---- エラーメッセージ(設計書12章) ----
  const MSG = {
    E01: 'このレコードの氏名または生年月日が未入力のため、コピー元を検索できません。先に氏名と生年月日を入力してください。',
    E03: 'コピー元となるレコードが見つかりませんでした。（氏名と生年月日が一致する別のレコードがありません）',
    E04: function (d) { return 'データの取得に失敗しました。通信環境をご確認のうえ、もう一度お試しください。（詳細: ' + d + '）'; },
    E05: 'この環境では「戻す」機能が使用できません（プライベートモード等）。このままコピーを実行しますか？\n※間違えた場合はkintoneの変更履歴での確認と手動復旧が必要になります。',
    E06: function (d) { return 'コピー前のバックアップ作成に失敗したため、処理を中止しました。レコードは変更されていません。（詳細: ' + d + '）'; },
    E07: function (f) { return 'コピー元の添付ファイルの取得に失敗したため、処理を中止しました。レコードは変更されていません。（ファイル名: ' + f + '）'; },
    E08: function (f) { return 'ファイルのアップロードに失敗したため、処理を中止しました。レコードは変更されていません。（ファイル名: ' + f + '）'; },
    E09: '他のユーザーがこのレコードを更新したため、処理を中止しました。ページを再読み込みして内容を確認のうえ、もう一度お試しください。レコードは変更されていません。',
    E10: function (d) { return 'レコードの更新に失敗しました。（kintoneからのメッセージ: ' + d + '）'; },
    E11: '戻せる履歴がありません。',
    E12: function (d) { return '元に戻す処理に失敗しました。バックアップは残っているため、もう一度お試しください。（詳細: ' + d + '）'; }
  };

  // ---- 実行環境ヘルパー(PC/モバイル両対応) ----
  let IS_MOBILE = false;

  function getAppId() {
    return IS_MOBILE ? kintone.mobile.app.getId() : kintone.app.getId();
  }
  function getRecordId() {
    return IS_MOBILE ? kintone.mobile.app.record.getId() : kintone.app.record.getId();
  }
  function getSpaceEl(id) {
    try {
      return IS_MOBILE
        ? kintone.mobile.app.record.getSpaceElement(id)
        : kintone.app.record.getSpaceElement(id);
    } catch (e) {
      return null;
    }
  }
  function getHeaderEl() {
    try {
      return IS_MOBILE
        ? kintone.mobile.app.getHeaderSpaceElement()
        : kintone.app.record.getHeaderMenuSpaceElement();
    } catch (e) {
      return null;
    }
  }
  // ゲストスペース対応のパス(レコード詳細リンク生成用)
  function getKPath() {
    const m = location.pathname.match(/^\/k\/guest\/(\d+)\//);
    return m ? '/k/guest/' + m[1] : '/k';
  }

  // ---- 汎用ユーティリティ ----
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // kintoneクエリ文字列用エスケープ(バックスラッシュとダブルクォート)
  function escapeQueryValue(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  // 日時表示(ISO文字列・Date・エポックms のいずれも受け付ける)
  function formatDateTime(v) {
    if (v == null || v === '') return '';
    const d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!isFinite(n) || n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  // 日付文字列(YYYY-MM-DD)を「YYYY年M月D日」表記に変換。未設定時は「（未設定）」
  function formatJpDate(v) {
    if (v == null || v === '') return '（未設定）';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(v);
    return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }
  // コピー方向カードや確認画面に表示する動的ラベルを生成
  // 例: 「2025年2月1日の【前期】を、このレコードの【前期】にコピー」
  function directionLabel(d, candidate) {
    const dateVal = (d.from === 'zenki')
      ? (candidate ? candidate.zenkiDate : '')
      : (candidate ? candidate.koukiDate : '');
    const fromLabel = SET_DEF[d.from].label.replace('セット', '');
    const toLabel = SET_DEF[d.to].label.replace('セット', '');
    return formatJpDate(dateVal) + 'の【' + fromLabel + '】を、このレコードの【' + toLabel + '】にコピー';
  }
  // ctx.fixedTarget('zenki'/'kouki')から表示用のセット名(前期セット/後期セット)を取得
  function targetSetLabel(ctx) {
    return SET_DEF[ctx.fixedTarget].label;
  }
  // レコードオブジェクトからテキスト値を安全に取得
  function getFieldText(record, code) {
    const f = record ? record[code] : null;
    return (f && f.value != null) ? String(f.value) : '';
  }
  // レコードオブジェクトから添付ファイル配列を安全に取得
  function getFieldFiles(record, code) {
    const f = record ? record[code] : null;
    return (f && Array.isArray(f.value)) ? f.value : [];
  }

  // 添付ファイル名は「後期評価2025-10-01岩本悠誠(案).pdf」のように
  // 先頭が前期/後期表記(＋任意で「評価」)＋日付(YYYY-MM-DD)＋氏名＋(種別)という
  // 命名で統一されている。前期⇔後期をまたぐコピー(D3/D4)の場合のみ、
  // ファイル名の前期/後期表記と日付を、コピー先(このレコード)の該当する期の
  // 値に合わせて書き換える。同じ期同士のコピー(D1/D2)では変更しない。
  function renameCopiedFileName(originalName, ctx) {
    if (ctx.direction.from === ctx.direction.to) return originalName;
    const m = String(originalName).match(/^(前期|後期)(評価)?(\d{4}-\d{2}-\d{2})(.*)$/);
    if (!m) return originalName; // 想定外の命名は変更せずそのまま
    const newLabel = SET_DEF[ctx.direction.to].label.replace('セット', '');
    const newDateRaw = (ctx.direction.to === 'zenki')
      ? getFieldText(ctx.currentRecord, CONFIG.FIELD_ZENKI_DATE)
      : getFieldText(ctx.currentRecord, CONFIG.FIELD_KOUKI_DATE);
    const newDate = newDateRaw || m[3]; // このレコードの該当日付が未設定なら元の日付を維持
    return newLabel + (m[2] || '') + newDate + m[4];
  }

  // ---- セット→34項目の順序付きリスト(設計書6.1の行順) ----
  function orderedFieldList(setKey) {
    const def = SET_DEF[setKey];
    const list = [];
    def.textFields.forEach(function (c) { list.push({ code: c, kind: 'text' }); });
    def.fileFields.forEach(function (c) { list.push({ code: c, kind: 'file' }); });
    return list;
  }
  // コピー元セット→コピー先セットの行単位対応表(34行)
  function buildRowMap(fromKey, toKey) {
    const src = orderedFieldList(fromKey);
    const dst = orderedFieldList(toKey);
    return src.map(function (s, i) {
      return { src: s.code, dst: dst[i].code, kind: s.kind };
    });
  }

  // ---- プレビュー用の行分析 ----
  // status: 'none'=変更なし / 'plain'=空欄へ新規コピー / 'over'=上書き / 'clear'=空欄で上書き
  function analyzeRow(row, srcRec, curRec) {
    if (row.kind === 'text') {
      const sv = getFieldText(srcRec, row.src);
      const cv = getFieldText(curRec, row.dst);
      const srcHas = sv !== '';
      const curHas = cv !== '';
      let status;
      if (sv === cv) status = 'none';
      else if (!curHas) status = 'plain';
      else if (srcHas) status = 'over';
      else status = 'clear';
      return { srcHas: srcHas, curHas: curHas, status: status, srcDisp: sv, curDisp: cv };
    }
    const sf = getFieldFiles(srcRec, row.src);
    const cf = getFieldFiles(curRec, row.dst);
    const srcHasF = sf.length > 0;
    const curHasF = cf.length > 0;
    let statusF;
    if (!srcHasF && !curHasF) statusF = 'none';
    else if (!curHasF) statusF = 'plain';
    else if (srcHasF) statusF = 'over';
    else statusF = 'clear';
    return { srcHas: srcHasF, curHas: curHasF, status: statusF, srcFiles: sf, curFiles: cf };
  }

  // ==========================================================
  // 【ブロック2】IndexedDB層(Undoスナップショット)・ファイル転送層
  // ==========================================================

  // ---- IndexedDB 基盤 ----
  let dbAvailable = null; // null=未判定 / true=使用可 / false=使用不可(プライベートモード等)

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('この環境ではIndexedDBを使用できません'));
        return;
      }
      const req = indexedDB.open(CONFIG.SNAPSHOT_DB_NAME, CONFIG.SNAPSHOT_DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(CONFIG.SNAPSHOT_STORE)) {
          const store = db.createObjectStore(CONFIG.SNAPSHOT_STORE, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('recordId', 'recordId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDBを開けませんでした')); };
    });
  }

  // 初回にIndexedDBの使用可否を判定して結果を保持する
  async function checkDbAvailable() {
    if (dbAvailable !== null) return dbAvailable;
    try {
      const db = await openDb();
      db.close();
      dbAvailable = true;
    } catch (e) {
      console.warn('[app207_field_copy] IndexedDBが使用できないため「戻す」機能を無効化します:', e);
      dbAvailable = false;
    }
    return dbAvailable;
  }

  // トランザクション完了をPromise化
  function txPromise(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDBトランザクションエラー')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDBトランザクションが中断されました')); };
    });
  }

  // スナップショット保存(戻り値: 採番されたid)
  async function saveSnapshot(snap) {
    const db = await openDb();
    try {
      const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(CONFIG.SNAPSHOT_STORE);
      let newId = null;
      const addReq = store.add(snap);
      addReq.onsuccess = function () { newId = addReq.result; };
      await txPromise(tx);
      return newId;
    } finally {
      db.close();
    }
  }

  // 対象レコード×対象セット(targetSetKey)の最新スナップショットを1件取得(なければnull)
  // ※autoIncrementのidは作成順に増加するため、'prev'方向カーソルを進めながら
  //   targetSetKeyが一致する最初の1件を返す
  async function getLatestSnapshot(recordId, targetSetKey) {
    const db = await openDb();
    try {
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readonly');
        const idx = tx.objectStore(CONFIG.SNAPSHOT_STORE).index('recordId');
        const req = idx.openCursor(IDBKeyRange.only(String(recordId)), 'prev');
        req.onsuccess = function () {
          const cur = req.result;
          if (!cur) { resolve(null); return; }
          if (cur.value.targetSetKey === targetSetKey) { resolve(cur.value); return; }
          cur.continue();
        };
        req.onerror = function () { reject(req.error || new Error('スナップショット取得エラー')); };
      });
    } finally {
      db.close();
    }
  }

  async function deleteSnapshot(id) {
    const db = await openDb();
    try {
      const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(CONFIG.SNAPSHOT_STORE).delete(id);
      await txPromise(tx);
    } finally {
      db.close();
    }
  }

  // コピー完了後、そのスナップショットに「コピー直後のrevision」を記録する
  async function updateSnapshotRevision(id, revision) {
    const db = await openDb();
    try {
      const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(CONFIG.SNAPSHOT_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = function () {
        const v = getReq.result;
        if (v) {
          v.revisionAfterCopy = String(revision == null ? '' : revision);
          store.put(v);
        }
      };
      await txPromise(tx);
    } finally {
      db.close();
    }
  }

  // 対象レコード×対象セットのスナップショット件数(値本体は読み込まない軽量カウント)
  async function countSnapshots(recordId, targetSetKey) {
    const db = await openDb();
    try {
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readonly');
        const idx = tx.objectStore(CONFIG.SNAPSHOT_STORE).index('recordId');
        let count = 0;
        const req = idx.openCursor(IDBKeyRange.only(String(recordId)));
        req.onsuccess = function () {
          const cur = req.result;
          if (cur) {
            if (cur.value.targetSetKey === targetSetKey) count++;
            cur.continue();
          } else {
            resolve(count);
          }
        };
        req.onerror = function () { reject(req.error || new Error('スナップショット件数取得エラー')); };
      });
    } finally {
      db.close();
    }
  }

  // 保持期限(TTL)を過ぎたスナップショットを全レコード横断で削除
  async function cleanupExpiredSnapshots() {
    const limit = Date.now() - CONFIG.SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000;
    const db = await openDb();
    try {
      const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(CONFIG.SNAPSHOT_STORE);
      const idx = store.index('createdAt');
      const doomed = [];
      const req = idx.openKeyCursor(IDBKeyRange.upperBound(limit));
      req.onsuccess = function () {
        const cur = req.result;
        if (cur) {
          doomed.push(cur.primaryKey);
          cur.continue();
        } else {
          doomed.forEach(function (id) { store.delete(id); });
        }
      };
      await txPromise(tx);
      return doomed.length;
    } finally {
      db.close();
    }
  }

  // 対象レコードのスナップショットを最新N件だけ残して古いものを削除
  // 対象レコード×対象セットのスナップショットを最新N件だけ残して古いものを削除
  async function trimSnapshots(recordId, targetSetKey) {
    const db = await openDb();
    try {
      const tx = db.transaction(CONFIG.SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(CONFIG.SNAPSHOT_STORE);
      const idx = store.index('recordId');
      const keys = [];
      const req = idx.openCursor(IDBKeyRange.only(String(recordId)));
      req.onsuccess = function () {
        const cur = req.result;
        if (cur) {
          if (cur.value.targetSetKey === targetSetKey) keys.push(cur.primaryKey);
          cur.continue();
        } else if (keys.length > CONFIG.SNAPSHOT_MAX_PER_RECORD) {
          keys.sort(function (a, b) { return a - b; }); // idの小さい順=古い順
          keys.slice(0, keys.length - CONFIG.SNAPSHOT_MAX_PER_RECORD)
            .forEach(function (id) { store.delete(id); });
        }
      };
      await txPromise(tx);
    } finally {
      db.close();
    }
  }

  // ---- ファイル転送層(kintoneファイルAPI) ----

  // 添付ファイルの実体(Blob)をダウンロード
  async function downloadFileBlob(fileKey, fileName) {
    const url = kintone.api.url('/k/v1/file.json', true) + '?fileKey=' + encodeURIComponent(fileKey);
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!resp.ok) {
      throw new Error('ダウンロード失敗（' + (fileName || fileKey) + ' / HTTP ' + resp.status + '）');
    }
    return await resp.blob();
  }

  // Blobをアップロードして新しいfileKeyを取得
  async function uploadFileBlob(blob, fileName, contentType) {
    let typed = blob;
    if (!blob.type && contentType) {
      typed = new Blob([blob], { type: contentType });
    }
    const fd = new FormData();
    fd.append('__REQUEST_TOKEN__', kintone.getRequestToken());
    fd.append('file', typed, fileName);
    const url = kintone.api.url('/k/v1/file.json', true);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: fd
    });
    if (!resp.ok) {
      throw new Error('アップロード失敗（' + fileName + ' / HTTP ' + resp.status + '）');
    }
    const json = await resp.json();
    if (!json || !json.fileKey) {
      throw new Error('アップロード応答にfileKeyが含まれていません（' + fileName + '）');
    }
    return json.fileKey;
  }

  // ==========================================================
  // 【ブロック3】UI層(スタイル・ポップアップ枠・各画面の描画)
  // ==========================================================

  // ---- スタイル注入 ----
  const STYLE_ID = 'a207fc_styles';
  const CSS_TEXT = `
.a207fc-btn-wrap{display:flex;flex-direction:column;gap:8px;max-width:240px;margin:8px 0;}
@media (max-width:767px){.a207fc-btn-wrap{max-width:100%;}}
.a207fc-btn-copy{background:#3B82F6;color:#fff;border:none;border-radius:6px;min-height:44px;font-size:15px;font-weight:bold;cursor:pointer;padding:10px 14px;}
.a207fc-btn-copy:disabled{opacity:0.6;cursor:default;}
.a207fc-btn-undo{background:#fff;color:#374151;border:1px solid #9CA3AF;border-radius:6px;min-height:44px;font-size:15px;font-weight:bold;cursor:pointer;padding:10px 14px;}
.a207fc-btn-undo:disabled{opacity:0.5;cursor:default;}
.a207fc-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:sans-serif;}
.a207fc-panel{background:#fff;border-radius:10px;width:min(920px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.25);}
@media (max-width:767px){.a207fc-overlay{padding:0;}.a207fc-panel{width:100vw;height:100dvh;max-height:100dvh;border-radius:0;}}
.a207fc-head{padding:14px 18px;border-bottom:1px solid #E5E7EB;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.a207fc-title{font-size:16px;font-weight:bold;color:#111827;margin:0;}
.a207fc-step{font-size:12px;color:#6B7280;margin-top:2px;}
.a207fc-close{background:none;border:none;font-size:24px;line-height:1;color:#6B7280;cursor:pointer;padding:2px 8px;flex-shrink:0;}
.a207fc-body{padding:16px 18px;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;}
.a207fc-foot{padding:12px 18px;border-top:1px solid #E5E7EB;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;}
@media (max-width:767px){.a207fc-foot{flex-direction:column-reverse;}.a207fc-foot .a207fc-fbtn{width:100%;}}
.a207fc-fbtn{min-height:44px;padding:10px 18px;border-radius:6px;font-size:15px;font-weight:bold;cursor:pointer;border:1px solid #9CA3AF;background:#fff;color:#374151;box-sizing:border-box;}
.a207fc-fbtn-primary{background:#3B82F6;border-color:#3B82F6;color:#fff;}
.a207fc-fbtn-danger{background:#DC2626;border-color:#DC2626;color:#fff;}
.a207fc-fbtn:disabled{opacity:0.5;cursor:default;}
.a207fc-lead{font-size:13px;color:#374151;margin:0 0 10px;line-height:1.7;}
.a207fc-table{width:100%;border-collapse:collapse;font-size:13px;}
.a207fc-table th,.a207fc-table td{border:1px solid #E5E7EB;padding:8px;text-align:left;vertical-align:top;word-break:break-word;}
.a207fc-table th{background:#F9FAFB;white-space:nowrap;}
.a207fc-row-click{cursor:pointer;}
.a207fc-row-selected{background:#EFF6FF;}
.a207fc-cards{display:flex;flex-direction:column;gap:10px;}
.a207fc-dircard{border:1px solid #D1D5DB;border-radius:8px;padding:12px 14px;min-height:56px;display:flex;align-items:center;gap:12px;cursor:pointer;box-sizing:border-box;font-size:14px;line-height:1.6;}
.a207fc-dircard.a207fc-selected{border-color:#3B82F6;background:#EFF6FF;}
.a207fc-dircard input{transform:scale(1.3);flex-shrink:0;}
.a207fc-dirnote{font-size:12px;color:#6B7280;}
.a207fc-summary{border:1px solid #E5E7EB;background:#F9FAFB;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.8;}
.a207fc-summary-warnbox{border:1px solid #DC2626;background:#FDECEC;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.8;}
.a207fc-warn{color:#B91C1C;font-weight:bold;}
.a207fc-badge{display:inline-block;font-size:11px;border-radius:4px;padding:2px 6px;margin-left:6px;font-weight:bold;vertical-align:middle;}
.a207fc-badge-over{background:#F59E0B;color:#fff;}
.a207fc-badge-clear{background:#DC2626;color:#fff;}
.a207fc-r-over{background:#FFF7E6;}
.a207fc-r-clear{background:#FDECEC;}
.a207fc-row-unselected{opacity:0.4;}
.a207fc-row-unselected .a207fc-badge{opacity:0.7;}
.a207fc-nochange{color:#9CA3AF;font-size:11px;margin-left:6px;}
.a207fc-empty{color:#9CA3AF;}
.a207fc-pre{white-space:pre-wrap;word-break:break-word;margin:0;font-size:13px;}
.a207fc-filelist{margin:0;padding-left:18px;font-size:13px;}
.a207fc-fname-row{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;}
.a207fc-fname-row:last-child{margin-bottom:0;}
.a207fc-fnameinput{flex:1;min-width:160px;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font-size:13px;box-sizing:border-box;}
.a207fc-fname-size{font-size:11px;color:#6B7280;white-space:nowrap;}
.a207fc-pc-only{display:block;}
.a207fc-sp-only{display:none;}
@media (max-width:767px){.a207fc-pc-only{display:none;}.a207fc-sp-only{display:block;}}
.a207fc-pcards{display:flex;flex-direction:column;gap:10px;}
.a207fc-pcard{border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;}
.a207fc-pcard h4{margin:0 0 6px;font-size:13px;}
.a207fc-plabel{font-size:11px;color:#6B7280;margin:8px 0 2px;}
.a207fc-progress{font-size:14px;line-height:2;}
.a207fc-prog-note{margin-top:14px;font-size:12px;color:#B91C1C;font-weight:bold;}
.a207fc-spinner{border:4px solid #f3f3f3;border-top:4px solid #3B82F6;border-radius:50%;width:36px;height:36px;animation:a207fc-spin 1s linear infinite;margin:0 auto 14px;}
@keyframes a207fc-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.a207fc-reclink{color:#2563EB;}
.a207fc-complete-msg{font-size:14px;line-height:1.8;}
.a207fc-complete-note{font-size:12px;color:#6B7280;margin-top:8px;line-height:1.7;}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  // ---- ポップアップ枠 ----
  const POPUP_ID = 'a207fc_popup';
  const popupState = { busy: false, lockClose: false };
  let leaveGuardOn = false;

  // 処理中のページ離脱(リロード/タブ閉じ)に警告を出す
  function leaveGuardHandler(e) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
  function enableLeaveGuard() {
    if (!leaveGuardOn) {
      window.addEventListener('beforeunload', leaveGuardHandler);
      leaveGuardOn = true;
    }
  }
  function disableLeaveGuard() {
    if (leaveGuardOn) {
      window.removeEventListener('beforeunload', leaveGuardHandler);
      leaveGuardOn = false;
    }
  }
  function canClosePopup() {
    return !popupState.busy && !popupState.lockClose;
  }

  function openPopup() {
    closePopup();
    injectStyles();
    popupState.busy = false;
    popupState.lockClose = false;
    const ov = document.createElement('div');
    ov.id = POPUP_ID;
    ov.className = 'a207fc-overlay';
    ov.innerHTML =
      '<div class="a207fc-panel">' +
        '<div class="a207fc-head">' +
          '<div>' +
            '<h3 class="a207fc-title" id="a207fc_title"></h3>' +
            '<div class="a207fc-step" id="a207fc_step"></div>' +
          '</div>' +
          '<button type="button" class="a207fc-close" id="a207fc_close" aria-label="閉じる">&#215;</button>' +
        '</div>' +
        '<div class="a207fc-body" id="a207fc_body"></div>' +
        '<div class="a207fc-foot" id="a207fc_foot"></div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('a207fc_close').onclick = function () {
      if (canClosePopup()) closePopup();
    };
    ov.addEventListener('click', function (e) {
      if (e.target === ov && canClosePopup()) closePopup();
    });
    document.addEventListener('keydown', escKeyHandler);
    return ov;
  }
  function escKeyHandler(e) {
    if (e.key === 'Escape' && canClosePopup()) closePopup();
  }
  function closePopup() {
    const ov = document.getElementById(POPUP_ID);
    if (ov) ov.remove();
    document.removeEventListener('keydown', escKeyHandler);
    popupState.busy = false;
    popupState.lockClose = false;
    disableLeaveGuard();
  }
  function setPopupHeader(title, step, closable) {
    const t = document.getElementById('a207fc_title');
    const s = document.getElementById('a207fc_step');
    const c = document.getElementById('a207fc_close');
    if (t) t.textContent = title || '';
    if (s) s.textContent = step || '';
    if (c) c.style.display = closable ? '' : 'none';
  }
  // 処理中フラグ(閉じる操作を全て封鎖し、離脱ガードを有効化)
  function setBusy(b) {
    popupState.busy = !!b;
    if (b) {
      const c = document.getElementById('a207fc_close');
      if (c) c.style.display = 'none';
      enableLeaveGuard();
    } else {
      disableLeaveGuard();
    }
  }
  // 操作可能な画面へ戻る際の共通リセット
  function resetInteractive() {
    popupState.busy = false;
    popupState.lockClose = false;
    disableLeaveGuard();
  }

  // ---- 画面部品ヘルパー ----
  // 値セル(テキスト or ファイル一覧)のHTML
  // rowDst/ctxは、コピー元(src)側のファイル名を編集可能な入力欄で表示するために使用する
  function valueCellHtml(kind, a, side, rowDst, ctx) {
    if (kind === 'text') {
      const v = side === 'src' ? a.srcDisp : a.curDisp;
      if (v === '') return '<span class="a207fc-empty">（空欄）</span>';
      return '<div class="a207fc-pre">' + escapeHtml(v) + '</div>';
    }
    if (side === 'src') {
      // コピー元ファイル: 保存されるファイル名を編集可能な入力欄で表示する
      const files = a.srcFiles;
      if (!files || files.length === 0) return '<span class="a207fc-empty">（ファイルなし）</span>';
      let html = '';
      files.forEach(function (f, idx) {
        const key = rowDst + '__' + idx;
        const size = formatFileSize(f.size);
        const val = (ctx.fileNameOverrides && ctx.fileNameOverrides[key] != null) ? ctx.fileNameOverrides[key] : f.name;
        html +=
          '<div class="a207fc-fname-row">' +
            '<input type="text" class="a207fc-fnameinput" data-key="' + escapeHtml(key) + '" value="' + escapeHtml(val) + '">' +
            (size ? '<span class="a207fc-fname-size">（' + escapeHtml(size) + '）</span>' : '') +
          '</div>';
      });
      return html;
    }
    // 現在の値(cur)側は従来どおり読み取り専用の一覧表示
    const files = a.curFiles;
    if (!files || files.length === 0) return '<span class="a207fc-empty">（ファイルなし）</span>';
    let li = '';
    files.forEach(function (f) {
      const size = formatFileSize(f.size);
      li += '<li>' + escapeHtml(f.name) + (size ? '（' + size + '）' : '') + '</li>';
    });
    return '<ul class="a207fc-filelist">' + li + '</ul>';
  }
  // 状態バッジのHTML
  function badgeHtml(status) {
    if (status === 'over') return '<span class="a207fc-badge a207fc-badge-over">上書き</span>';
    if (status === 'clear') return '<span class="a207fc-badge a207fc-badge-clear">空欄で上書き（現在の内容は削除されます）</span>';
    if (status === 'none') return '<span class="a207fc-nochange">変更なし</span>';
    return '';
  }
  // 行のハイライト用クラス属性
  function rowClassAttr(status) {
    if (status === 'over') return ' class="a207fc-r-over"';
    if (status === 'clear') return ' class="a207fc-r-clear"';
    return '';
  }

  // ---- STEP1: コピー元レコードの選択 ----
  function renderStep1(ctx) {
    resetInteractive();
    setPopupHeader('他レコードからコピー', 'STEP 1/3：コピー元レコードの選択（コピー先：' + targetSetLabel(ctx) + '）', true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    const zenkiFileFields = STEP1_ZENKI_FILE_FIELDS;
    const koukiFileFields = STEP1_KOUKI_FILE_FIELDS;
    let rowsHtml = '';
    ctx.candidates.forEach(function (c) {
      const isSel = ctx.selectedCandidateId === c.id;
      let zenkiIcons = '';
      zenkiFileFields.forEach(function (code) {
        zenkiIcons += '<td style="text-align:center;">' + (c.fileFlags && c.fileFlags[code] ? '⭕' : '❌') + '</td>';
      });
      let koukiIcons = '';
      koukiFileFields.forEach(function (code) {
        koukiIcons += '<td style="text-align:center;">' + (c.fileFlags && c.fileFlags[code] ? '⭕' : '❌') + '</td>';
      });
      rowsHtml +=
        '<tr class="a207fc-row-click' + (isSel ? ' a207fc-row-selected' : '') + '" data-cid="' + escapeHtml(c.id) + '">' +
          '<td style="text-align:center;"><input type="radio" name="a207fc_cand" value="' + escapeHtml(c.id) + '"' + (isSel ? ' checked' : '') + '></td>' +
          '<td>' + (c.zenkiDate ? escapeHtml(c.zenkiDate) : '<span class="a207fc-empty">（未設定）</span>') + '</td>' +
          '<td>' + (c.koukiDate ? escapeHtml(c.koukiDate) : '<span class="a207fc-empty">（未設定）</span>') + '</td>' +
          zenkiIcons + koukiIcons +
          '<td>' + escapeHtml(formatDateTime(c.updatedAt)) + (c.updater ? '<br>' + escapeHtml(c.updater) : '') + '</td>' +
        '</tr>';
    });
    let zenkiHead2 = '';
    zenkiFileFields.forEach(function (code, i) {
      zenkiHead2 += '<th style="white-space:nowrap;">' + escapeHtml(STEP1_FILE_SHORT_LABELS[i]) + '</th>';
    });
    let koukiHead2 = '';
    koukiFileFields.forEach(function (code, i) {
      koukiHead2 += '<th style="white-space:nowrap;">' + escapeHtml(STEP1_FILE_SHORT_LABELS[i]) + '</th>';
    });
    body.innerHTML =
      '<p class="a207fc-lead">氏名と生年月日が一致する別のレコードが ' + ctx.candidates.length + ' 件見つかりました。' +
      'コピー元にするレコードを1つ選んでください。（添付ファイル列は⭕：保存あり　❌：保存なし）</p>' +
      '<div style="overflow-x:auto;">' +
        '<table class="a207fc-table">' +
          '<thead>' +
            '<tr>' +
              '<th rowspan="2" style="width:44px;">選択</th>' +
              '<th rowspan="2">前期計画開始</th>' +
              '<th rowspan="2">後期計画開始</th>' +
              '<th colspan="' + zenkiFileFields.length + '">前期添付ファイル</th>' +
              '<th colspan="' + koukiFileFields.length + '">後期添付ファイル</th>' +
              '<th rowspan="2">最終更新</th>' +
            '</tr>' +
            '<tr>' + zenkiHead2 + koukiHead2 + '</tr>' +
          '</thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';
    foot.innerHTML =
      '<button type="button" class="a207fc-fbtn" id="a207fc_cancel1">キャンセル</button>' +
      '<button type="button" class="a207fc-fbtn a207fc-fbtn-primary" id="a207fc_next1"' + (ctx.selectedCandidateId ? '' : ' disabled') + '>次へ</button>';
    // 行クリックで選択
    body.querySelectorAll('tr.a207fc-row-click').forEach(function (tr) {
      tr.addEventListener('click', function () {
        const cid = tr.getAttribute('data-cid');
        ctx.selectedCandidateId = cid;
        ctx.selectedCandidate = null;
        for (let i = 0; i < ctx.candidates.length; i++) {
          if (ctx.candidates[i].id === cid) { ctx.selectedCandidate = ctx.candidates[i]; break; }
        }
        const radio = tr.querySelector('input[type=radio]');
        if (radio) radio.checked = true;
        body.querySelectorAll('tr.a207fc-row-click').forEach(function (x) {
          x.classList.remove('a207fc-row-selected');
        });
        tr.classList.add('a207fc-row-selected');
        const nx = document.getElementById('a207fc_next1');
        if (nx) nx.disabled = false;
      });
    });
    document.getElementById('a207fc_cancel1').onclick = function () { closePopup(); };
    document.getElementById('a207fc_next1').onclick = function () {
      if (ctx.selectedCandidateId) renderStep2(ctx);
    };
  }

  // ---- STEP2: コピー方向の選択 ----
  function renderStep2(ctx) {
    resetInteractive();
    setPopupHeader('他レコードからコピー', 'STEP 2/3：コピー元セットの選択（コピー先：' + targetSetLabel(ctx) + '）', true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    // コピー先(ctx.fixedTarget)はスペース(move1/move2)により固定済みのため、
    // コピー元となるセット(前期/後期)の2択のみを表示する
    const availableDirections = DIRECTIONS.filter(function (d) { return d.to === ctx.fixedTarget; });
    let cardsHtml = '';
    availableDirections.forEach(function (d) {
      const isSel = ctx.direction && ctx.direction.id === d.id;
      cardsHtml +=
        '<label class="a207fc-dircard' + (isSel ? ' a207fc-selected' : '') + '" data-did="' + d.id + '">' +
          '<input type="radio" name="a207fc_dir" value="' + d.id + '"' + (isSel ? ' checked' : '') + '>' +
          '<span>' + escapeHtml(directionLabel(d, ctx.selectedCandidate)) +
            (d.note ? '<br><span class="a207fc-dirnote">' + escapeHtml(d.note) + '</span>' : '') +
          '</span>' +
        '</label>';
    });
    body.innerHTML =
      '<p class="a207fc-lead">選んだレコード（レコード番号 ' + escapeHtml(String(ctx.selectedCandidateId)) + '）の' +
      'どちらのセットを、このレコードの【' + escapeHtml(targetSetLabel(ctx)) + '】へコピーするか選んでください。</p>' +
      '<div class="a207fc-cards">' + cardsHtml + '</div>';
    foot.innerHTML =
      '<button type="button" class="a207fc-fbtn" id="a207fc_back2">戻る</button>' +
      '<button type="button" class="a207fc-fbtn" id="a207fc_cancel2">キャンセル</button>' +
      '<button type="button" class="a207fc-fbtn a207fc-fbtn-primary" id="a207fc_next2"' + (ctx.direction ? '' : ' disabled') + '>次へ（確認画面へ）</button>';
    body.querySelectorAll('.a207fc-dircard').forEach(function (card) {
      card.addEventListener('click', function () {
        const did = card.getAttribute('data-did');
        ctx.direction = null;
        for (let i = 0; i < availableDirections.length; i++) {
          if (availableDirections[i].id === did) { ctx.direction = availableDirections[i]; break; }
        }
        body.querySelectorAll('.a207fc-dircard').forEach(function (x) {
          x.classList.remove('a207fc-selected');
        });
        card.classList.add('a207fc-selected');
        const r = card.querySelector('input');
        if (r) r.checked = true;
        const nx = document.getElementById('a207fc_next2');
        if (nx) nx.disabled = false;
      });
    });
    document.getElementById('a207fc_back2').onclick = function () { renderStep1(ctx); };
    document.getElementById('a207fc_cancel2').onclick = function () { closePopup(); };
    document.getElementById('a207fc_next2').onclick = function () {
      if (ctx.direction) loadSourceAndPreview(ctx);
    };
  }

  // ---- STEP2→3: コピー元レコードの読み込み ----
  async function loadSourceAndPreview(ctx) {
    resetInteractive();
    setPopupHeader('他レコードからコピー', 'STEP 3/3：コピー内容の確認', true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    body.innerHTML =
      '<div class="a207fc-spinner"></div>' +
      '<p style="text-align:center;font-size:13px;color:#6B7280;">コピー元レコードを読み込んでいます…</p>';
    foot.innerHTML = '';
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', {
        app: ctx.appId,
        id: ctx.selectedCandidateId
      });
      if (!document.getElementById(POPUP_ID)) return; // 読み込み中に閉じられた場合は中断
      ctx.sourceRecord = resp.record;
      ctx.sourceRevision = resp.record.$revision.value;
      renderStep3(ctx);
    } catch (e) {
      console.error('[app207_field_copy] コピー元読み込みエラー:', e);
      if (!document.getElementById(POPUP_ID)) return;
      alert(MSG.E04(e && e.message ? e.message : String(e)));
      renderStep2(ctx);
    }
  }

  // ---- STEP3: コピー内容の確認(プレビュー) ----
  function renderStep3(ctx) {
    resetInteractive();
    setPopupHeader('他レコードからコピー', 'STEP 3/3：コピー内容の確認（コピー先：' + targetSetLabel(ctx) + '）', true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    const rows = buildRowMap(ctx.direction.from, ctx.direction.to);
    // このSTEP3に入るたびに選択状態を初期化(全項目を選択済みにする)
    ctx.selection = {};
    rows.forEach(function (r) { ctx.selection[r.dst] = true; });

    const analyses = rows.map(function (r) {
      return { row: r, a: analyzeRow(r, ctx.sourceRecord, ctx.currentRecord) };
    });

    // コピー元ファイルの保存名(既定値)を計算して初期化する。
    // 前期/後期をまたぐ場合はrenameCopiedFileName()による自動付け替え結果を初期値とし、
    // ユーザーが手入力で上書きできるようにする。
    ctx.fileNameOverrides = {};
    analyses.forEach(function (x) {
      if (x.row.kind !== 'file' || !x.a.srcFiles) return;
      x.a.srcFiles.forEach(function (f, idx) {
        const key = x.row.dst + '__' + idx;
        ctx.fileNameOverrides[key] = renameCopiedFileName(f.name, ctx);
      });
    });

    let cntSrc = 0, cntOver = 0, cntClear = 0;
    analyses.forEach(function (x) {
      if (x.a.srcHas) cntSrc++;
      if (x.a.status === 'over') cntOver++;
      if (x.a.status === 'clear') cntClear++;
    });
    const dstLabel = SET_DEF[ctx.direction.to].label;
    const totalCount = rows.length;

    const summaryHtml =
      '<div class="a207fc-summary">' +
        '<div><strong>' + escapeHtml(directionLabel(ctx.direction, ctx.selectedCandidate)) + '</strong>' +
          '（コピー元レコード番号 ' + escapeHtml(String(ctx.selectedCandidateId)) + '）</div>' +
        '<div class="a207fc-warn">チェックを入れた項目だけが上書きされます（空欄も含めて丸ごと置き換え）。チェックを外した項目は現在の内容のまま変更されません。</div>' +
        '<div>添付ファイルの保存名は下欄のとおりです。このファイル名でよろしいですか？　必要であれば直接書き換えられます。</div>' +
        '<div>コピー元に値がある項目 ' + cntSrc + '/' + totalCount + '　・　現在の値が置き換わる項目 ' + cntOver + '　・　空欄で上書きされる項目 ' + cntClear + '</div>' +
        '<div>選択中の項目：<span id="a207fc_selcount">' + totalCount + '</span>/' + totalCount + '件</div>' +
      '</div>' +
      '<label class="a207fc-dircard" style="margin-bottom:12px;">' +
        '<input type="checkbox" id="a207fc_selall" checked>' +
        '<span>全て選択</span>' +
      '</label>';

    // PC用: 3列テーブル(先頭にチェックボックス列)
    let pcRows = '';
    analyses.forEach(function (x) {
      const label = x.row.src === x.row.dst ? x.row.src : (x.row.src + ' → ' + x.row.dst);
      pcRows +=
        '<tr' + rowClassAttr(x.a.status) + ' data-rowcode="' + escapeHtml(x.row.dst) + '">' +
          '<td style="text-align:center;width:36px;"><input type="checkbox" class="a207fc-rowchk" data-code="' + escapeHtml(x.row.dst) + '" checked></td>' +
          '<td style="width:20%;"><strong>' + escapeHtml(label) + '</strong>' + badgeHtml(x.a.status) + '</td>' +
          '<td style="width:38%;">' + valueCellHtml(x.row.kind, x.a, 'src', x.row.dst, ctx) + '</td>' +
          '<td style="width:38%;">' + valueCellHtml(x.row.kind, x.a, 'cur', x.row.dst, ctx) + '</td>' +
        '</tr>';
    });
    const pcTableHtml =
      '<div class="a207fc-pc-only" style="overflow-x:auto;">' +
        '<table class="a207fc-table">' +
          '<thead><tr><th>コピー</th><th>項目名</th><th>コピー元の値</th><th>現在の値（上書きされる側）</th></tr></thead>' +
          '<tbody>' + pcRows + '</tbody>' +
        '</table>' +
      '</div>';

    // スマホ用: 項目ごとのカード(先頭にチェックボックス)
    let spCards = '';
    analyses.forEach(function (x) {
      const label = x.row.src === x.row.dst ? x.row.src : (x.row.src + ' → ' + x.row.dst);
      const cardCls = x.a.status === 'over' ? ' a207fc-r-over' : (x.a.status === 'clear' ? ' a207fc-r-clear' : '');
      spCards +=
        '<div class="a207fc-pcard' + cardCls + '" data-rowcode="' + escapeHtml(x.row.dst) + '">' +
          '<h4><label style="display:flex;align-items:center;gap:8px;">' +
            '<input type="checkbox" class="a207fc-rowchk" data-code="' + escapeHtml(x.row.dst) + '" checked>' +
            '<span>' + escapeHtml(label) + badgeHtml(x.a.status) + '</span>' +
          '</label></h4>' +
          '<div class="a207fc-plabel">コピー元の値</div>' + valueCellHtml(x.row.kind, x.a, 'src', x.row.dst, ctx) +
          '<div class="a207fc-plabel">現在の値（上書きされる側）</div>' + valueCellHtml(x.row.kind, x.a, 'cur', x.row.dst, ctx) +
        '</div>';
    });
    const spCardsHtml = '<div class="a207fc-sp-only"><div class="a207fc-pcards">' + spCards + '</div></div>';

    body.innerHTML = summaryHtml + pcTableHtml + spCardsHtml;
    foot.innerHTML =
      '<button type="button" class="a207fc-fbtn" id="a207fc_back3">戻る</button>' +
      '<button type="button" class="a207fc-fbtn" id="a207fc_cancel3">キャンセル</button>' +
      '<button type="button" class="a207fc-fbtn a207fc-fbtn-danger" id="a207fc_exec3">この内容で上書き実行</button>';

    // ---- チェックボックスの同期ロジック ----
    // 同じdata-codeのチェックボックスはPC表とスマホカードの両方に存在するため、
    // 片方を変更したらもう片方にも反映する。
    function setRowVisualSelected(code, checked) {
      body.querySelectorAll('[data-rowcode="' + code + '"]').forEach(function (el) {
        el.classList.toggle('a207fc-row-unselected', !checked);
      });
    }
    function updateSelCountAndButton() {
      const total = Object.keys(ctx.selection).length;
      const selected = Object.values(ctx.selection).filter(Boolean).length;
      const cntEl = document.getElementById('a207fc_selcount');
      if (cntEl) cntEl.textContent = String(selected);
      const execBtn = document.getElementById('a207fc_exec3');
      if (execBtn) execBtn.disabled = (selected === 0);
      const selAll = document.getElementById('a207fc_selall');
      if (selAll) {
        selAll.checked = (selected === total);
        selAll.indeterminate = (selected > 0 && selected < total);
      }
    }
    body.querySelectorAll('.a207fc-rowchk').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const code = chk.getAttribute('data-code');
        const checked = chk.checked;
        ctx.selection[code] = checked;
        // 同じ項目のPC/スマホ両方のチェックボックスを同期
        body.querySelectorAll('.a207fc-rowchk[data-code="' + code + '"]').forEach(function (other) {
          other.checked = checked;
        });
        setRowVisualSelected(code, checked);
        updateSelCountAndButton();
      });
    });
    // ---- ファイル名入力欄の同期ロジック ----
    // 同じdata-keyの入力欄はPC表とスマホカードの両方に存在するため、
    // 片方を編集したらもう片方にも反映し、ctx.fileNameOverridesへ保存する。
    body.querySelectorAll('.a207fc-fnameinput').forEach(function (inp) {
      inp.addEventListener('input', function () {
        const key = inp.getAttribute('data-key');
        const val = inp.value;
        ctx.fileNameOverrides[key] = val;
        body.querySelectorAll('.a207fc-fnameinput[data-key="' + key + '"]').forEach(function (other) {
          if (other !== inp) other.value = val;
        });
      });
    });
    const selAllBox = document.getElementById('a207fc_selall');
    if (selAllBox) {
      selAllBox.addEventListener('change', function () {
        const checked = selAllBox.checked;
        Object.keys(ctx.selection).forEach(function (code) {
          ctx.selection[code] = checked;
          setRowVisualSelected(code, checked);
        });
        body.querySelectorAll('.a207fc-rowchk').forEach(function (chk) { chk.checked = checked; });
        updateSelCountAndButton();
      });
    }

    document.getElementById('a207fc_back3').onclick = function () { renderStep2(ctx); };
    document.getElementById('a207fc_cancel3').onclick = function () { closePopup(); };
    document.getElementById('a207fc_exec3').onclick = function () {
      const anySelected = Object.values(ctx.selection).some(Boolean);
      if (!anySelected) {
        alert('コピーする項目が選択されていません。少なくとも1項目を選択してください。');
        return;
      }
      if (!dbAvailable) {
        if (!window.confirm(MSG.E05)) return; // E-05: 戻す機能なしでの実行確認
      }
      executeCopy(ctx);
    };
  }

  // ---- STEP4: コピー実行中の進捗表示 ----
  function renderProgress(ctx) {
    setPopupHeader('コピーを実行しています', 'コピー先：' + targetSetLabel(ctx) + '／しばらくお待ちください', false);
    popupState.lockClose = false;
    setBusy(true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    body.innerHTML =
      '<div class="a207fc-spinner"></div>' +
      '<div class="a207fc-progress">' +
        '<div id="a207fc_p1">1. 現在の内容をバックアップ中（戻す用）… 待機中</div>' +
        '<div id="a207fc_p2">2. コピー元ファイルをダウンロード中… 待機中</div>' +
        '<div id="a207fc_p3">3. ファイルをアップロード中… 待機中</div>' +
        '<div id="a207fc_p4">4. レコードを更新中… 待機中</div>' +
      '</div>' +
      '<div class="a207fc-prog-note">処理中はこの画面を閉じないでください（添付ファイルが多い場合、数十秒かかることがあります）</div>';
    foot.innerHTML = '';
  }
  function setProgressLine(n, text) {
    const el = document.getElementById('a207fc_p' + n);
    if (el) el.textContent = text;
  }

  // ---- STEP5: コピー完了 ----
  function renderComplete(ctx) {
    popupState.busy = false;
    disableLeaveGuard();
    popupState.lockClose = true; // 再読み込み以外の操作を封鎖
    setPopupHeader('コピー完了', 'コピー先：' + targetSetLabel(ctx), false);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    const note = dbAvailable
      ? '間違えた場合は、再読み込み後に「コピー前に戻す」ボタンで元に戻せます。'
      : 'この環境では「戻す」機能が使用できないため、内容をよくご確認ください。';
    body.innerHTML =
      '<p class="a207fc-complete-msg">コピーが完了しました。ページを再読み込みして最新の内容を表示します。</p>' +
      '<p class="a207fc-complete-note">' + escapeHtml(note) + '</p>';
    foot.innerHTML =
      '<button type="button" class="a207fc-fbtn a207fc-fbtn-primary" id="a207fc_reload">再読み込み</button>';
    document.getElementById('a207fc_reload').onclick = function () { location.reload(); };
  }

  // ---- Undo: 確認ダイアログ ----
  function renderUndoConfirm(ctxU) {
    resetInteractive();
    const setDef = SET_DEF[ctxU.snap.targetSetKey];
    const setLabel = setDef ? setDef.label : String(ctxU.snap.targetSetKey);
    setPopupHeader('コピー前に戻す', '確認（対象：' + setLabel + '）', true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    const textCodes = Object.keys(ctxU.snap.fields || {});
    const fileFieldCodes = Object.keys(ctxU.snap.files || {});
    let fileCount = 0;
    const files = ctxU.snap.files || {};
    fileFieldCodes.forEach(function (k) {
      fileCount += (files[k] || []).length;
    });
    const srcInfo = ctxU.snap.sourceInfo || {};
    const warnHtml = ctxU.mismatch
      ? '<div class="a207fc-summary-warnbox"><span class="a207fc-warn">注意：このバックアップの後にレコードが更新されています。戻すと、その後の変更も上書きされます。</span></div>'
      : '';
    body.innerHTML =
      '<p class="a207fc-lead">最後のコピー操作を取り消し、コピー前の状態に戻します。</p>' +
      '<div class="a207fc-summary">' +
        '<div>戻す対象：このレコードの【' + escapeHtml(setLabel) + '】のうち、今回のコピーで変更された項目' +
          '（テキスト' + textCodes.length + '項目／添付' + fileFieldCodes.length + '項目、ファイル' + fileCount + '件）</div>' +
        '<div>バックアップ作成日時：' + escapeHtml(formatDateTime(ctxU.snap.createdAt)) + '</div>' +
        '<div>元となったコピー操作：' + escapeHtml(srcInfo.direction || '') + '（コピー元レコード番号 ' + escapeHtml(srcInfo.recordId || '?') + '）</div>' +
      '</div>' +
      warnHtml;
    foot.innerHTML =
      '<button type="button" class="a207fc-fbtn" id="a207fc_ucancel">キャンセル</button>' +
      '<button type="button" class="a207fc-fbtn a207fc-fbtn-danger" id="a207fc_uexec">戻す実行</button>';
    document.getElementById('a207fc_ucancel').onclick = function () { closePopup(); };
    document.getElementById('a207fc_uexec').onclick = function () { executeUndo(ctxU); };
  }

  // ---- Undo: 実行中の進捗表示 ----
  function renderUndoProgress(ctxU) {
    const setDef = SET_DEF[ctxU.snap.targetSetKey];
    const setLabel = setDef ? setDef.label : String(ctxU.snap.targetSetKey);
    setPopupHeader('元に戻しています', '対象：' + setLabel + '／しばらくお待ちください', false);
    popupState.lockClose = false;
    setBusy(true);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    body.innerHTML =
      '<div class="a207fc-spinner"></div>' +
      '<div class="a207fc-progress">' +
        '<div id="a207fc_p1">1. バックアップファイルをアップロード中… 待機中</div>' +
        '<div id="a207fc_p2">2. レコードを更新中… 待機中</div>' +
      '</div>' +
      '<div class="a207fc-prog-note">処理中はこの画面を閉じないでください</div>';
    foot.innerHTML = '';
  }

  // ---- Undo: 完了 ----
  function renderUndoComplete(ctxU) {
    popupState.busy = false;
    disableLeaveGuard();
    popupState.lockClose = true;
    const setDef = SET_DEF[ctxU.snap.targetSetKey];
    const setLabel = setDef ? setDef.label : String(ctxU.snap.targetSetKey);
    setPopupHeader('完了', '対象：' + setLabel, false);
    const body = document.getElementById('a207fc_body');
    const foot = document.getElementById('a207fc_foot');
    body.innerHTML =
      '<p class="a207fc-complete-msg">元に戻す処理が完了しました。ページを再読み込みして最新の内容を表示します。</p>';
    foot.innerHTML =
      '<button type="button" class="a207fc-fbtn a207fc-fbtn-primary" id="a207fc_ureload">再読み込み</button>';
    document.getElementById('a207fc_ureload').onclick = function () { location.reload(); };
  }

  // ==========================================================
  // 【ブロック4】フロー制御(コピー実行・Undo実行・ボタン設置・イベント登録)
  // ==========================================================

  const WRAP_ID_ZENKI = 'a207fc_btn_wrap_zenki';
  const WRAP_ID_KOUKI = 'a207fc_btn_wrap_kouki';

  // ---- [他レコードからコピー]ボタン押下 → 検索 → ウィザード開始 ----
  // fixedTarget: 'zenki'(move1のボタン) または 'kouki'(move2のボタン)。コピー先はこの時点で確定する
  async function onCopyButtonClick(btn, fixedTarget, copyLabelBase) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '検索中…';
    }
    try {
      const appId = getAppId();
      const recordId = getRecordId();
      // A1: 現在のレコードを取得(値+revision)
      const cur = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', {
        app: appId,
        id: recordId
      });
      const curRec = cur.record;
      const name = getFieldText(curRec, CONFIG.FIELD_NAME);
      const birth = getFieldText(curRec, CONFIG.FIELD_BIRTH);
      if (!name || !birth) {
        alert(MSG.E01); // E-01: 照合キー未入力
        return;
      }
      // A3: 氏名+生年月日が一致する別レコードを検索(自レコード除外)
      const query =
        CONFIG.FIELD_NAME + ' = "' + escapeQueryValue(name) + '"' +
        ' and ' + CONFIG.FIELD_BIRTH + ' = "' + birth + '"' +
        ' and $id != "' + recordId + '"' +
        ' order by ' + CONFIG.FIELD_ZENKI_DATE + ' desc' +
        ' limit ' + CONFIG.CANDIDATE_LIMIT;
      let resp = null;
      const attachFieldCodes = STEP1_ZENKI_FILE_FIELDS.concat(STEP1_KOUKI_FILE_FIELDS);
      const wantFields = ['$id', CONFIG.FIELD_ZENKI_DATE, CONFIG.FIELD_KOUKI_DATE, '更新日時', '更新者'].concat(attachFieldCodes);
      try {
        resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
          app: appId,
          query: query,
          fields: wantFields
        });
      } catch (eFields) {
        // 更新日時/更新者/添付フィールドのフィールドコードが変更されている環境向けのフォールバック
        console.warn('[app207_field_copy] fields指定での取得に失敗したため全フィールドで再試行します:', eFields);
        resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
          app: appId,
          query: query
        });
      }
      const recs = (resp && resp.records) ? resp.records : [];
      if (recs.length === 0) {
        alert(MSG.E03); // E-03: 候補なし
        return;
      }
      const candidates = recs.map(function (r) {
        const fileFlags = {};
        attachFieldCodes.forEach(function (code) {
          const v = r[code] && Array.isArray(r[code].value) ? r[code].value : [];
          fileFlags[code] = v.length > 0;
        });
        return {
          id: r.$id.value,
          zenkiDate: (r[CONFIG.FIELD_ZENKI_DATE] && r[CONFIG.FIELD_ZENKI_DATE].value) ? r[CONFIG.FIELD_ZENKI_DATE].value : '',
          koukiDate: (r[CONFIG.FIELD_KOUKI_DATE] && r[CONFIG.FIELD_KOUKI_DATE].value) ? r[CONFIG.FIELD_KOUKI_DATE].value : '',
          updatedAt: (r['更新日時'] && r['更新日時'].value) ? r['更新日時'].value : '',
          updater: (r['更新者'] && r['更新者'].value && r['更新者'].value.name) ? r['更新者'].value.name : '',
          fileFlags: fileFlags
        };
      });
      // 並び: 前期計画開始の降順 → 未設定は末尾(更新日時の降順)
      candidates.sort(function (a, b) {
        if (a.zenkiDate && b.zenkiDate) {
          if (a.zenkiDate < b.zenkiDate) return 1;
          if (a.zenkiDate > b.zenkiDate) return -1;
          if (a.updatedAt < b.updatedAt) return 1;
          if (a.updatedAt > b.updatedAt) return -1;
          return 0;
        }
        if (a.zenkiDate && !b.zenkiDate) return -1;
        if (!a.zenkiDate && b.zenkiDate) return 1;
        if (a.updatedAt < b.updatedAt) return 1;
        if (a.updatedAt > b.updatedAt) return -1;
        return 0;
      });
      const ctx = {
        appId: appId,
        recordId: String(recordId),
        currentRecord: curRec,
        currentRevision: curRec.$revision.value,
        candidates: candidates,
        selectedCandidateId: null,
        selectedCandidate: null,
        fixedTarget: fixedTarget,
        direction: null,
        sourceRecord: null,
        sourceRevision: null
      };
      openPopup();
      renderStep1(ctx);
    } catch (e) {
      console.error('[app207_field_copy] 検索エラー:', e);
      alert(MSG.E04(e && e.message ? e.message : String(e)));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = copyLabelBase;
      }
    }
  }

  // ---- コピー実行(STEP4本体・設計書8.1の(a)〜(f)) ----
  async function executeCopy(ctx) {
    renderProgress(ctx);
    let snapshotId = null;
    let currentFileName = '';
    try {
      // (a) コピー元を再取得しrevisionを照合(プレビュー後の更新検知)
      const freshResp = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', {
        app: ctx.appId,
        id: ctx.selectedCandidateId
      });
      const freshRev = freshResp.record.$revision.value;
      if (String(freshRev) !== String(ctx.sourceRevision)) {
        const ok = window.confirm(
          'コピー元レコードがプレビュー表示後に更新されています。最新の内容でコピーしますか？\n' +
          '（OK：最新の内容でプレビューを再表示します／キャンセル：先ほどのプレビューに戻ります）'
        );
        if (ok) {
          ctx.sourceRecord = freshResp.record;
          ctx.sourceRevision = freshRev;
        }
        renderStep3(ctx); // どちらの場合も確認画面へ戻り、再度実行ボタンを押してもらう
        return;
      }
      ctx.sourceRecord = freshResp.record;

      // 選択されている項目(チェックが入っている行)だけを処理対象にする
      const allRows = buildRowMap(ctx.direction.from, ctx.direction.to);
      const rows = allRows.filter(function (r) { return !!(ctx.selection && ctx.selection[r.dst]); });
      if (rows.length === 0) {
        closePopup();
        alert('コピーする項目が選択されていません。');
        return;
      }
      const dstTextCodes = rows.filter(function (r) { return r.kind === 'text'; }).map(function (r) { return r.dst; });
      const dstFileCodes = rows.filter(function (r) { return r.kind === 'file'; }).map(function (r) { return r.dst; });
      const resolvedDirectionLabel = directionLabel(ctx.direction, ctx.selectedCandidate);

      // (b) スナップショット作成(戻す用バックアップ: 選択された項目のテキスト値+添付Blob実体のみ)
      if (dbAvailable) {
        try {
          const snapFields = {};
          dstTextCodes.forEach(function (code) {
            snapFields[code] = getFieldText(ctx.currentRecord, code);
          });
          let totalBk = 0;
          dstFileCodes.forEach(function (code) {
            totalBk += getFieldFiles(ctx.currentRecord, code).length;
          });
          let doneBk = 0;
          setProgressLine(1, '1. 現在の内容をバックアップ中（戻す用）… ' + (totalBk === 0 ? '対象ファイルなし' : 'ファイル 0/' + totalBk));
          const snapFiles = {};
          for (const code of dstFileCodes) {
            const metas = getFieldFiles(ctx.currentRecord, code);
            const arr = [];
            for (const m of metas) {
              currentFileName = m.name || '';
              setProgressLine(1, '1. 現在の内容をバックアップ中（戻す用）… ファイル ' + (doneBk + 1) + '/' + totalBk);
              const blob = await downloadFileBlob(m.fileKey, m.name);
              arr.push({ name: m.name, contentType: m.contentType || blob.type || '', blob: blob });
              doneBk++;
            }
            snapFiles[code] = arr;
          }
          const snap = {
            recordId: String(ctx.recordId),
            createdAt: Date.now(),
            targetSetKey: ctx.direction.to,
            sourceInfo: {
              recordId: String(ctx.selectedCandidateId),
              zenkiDate: ctx.selectedCandidate ? (ctx.selectedCandidate.zenkiDate || '') : '',
              direction: resolvedDirectionLabel
            },
            revisionAfterCopy: '',
            fields: snapFields,
            files: snapFiles
          };
          snapshotId = await saveSnapshot(snap);
          setProgressLine(1, '1. 現在の内容をバックアップ中（戻す用）… 完了（ファイル ' + totalBk + '件）');
        } catch (eBk) {
          console.error('[app207_field_copy] バックアップ作成エラー:', eBk);
          closePopup();
          alert(MSG.E06(eBk && eBk.message ? eBk.message : String(eBk))); // E-06
          return;
        }
      } else {
        setProgressLine(1, '1. バックアップ… スキップ（この環境では「戻す」機能を使用できません）');
      }

      // (c) コピー元の添付ファイルをダウンロード
      const srcFilePack = {};
      try {
        let totalDl = 0;
        rows.forEach(function (r) {
          if (r.kind === 'file') totalDl += getFieldFiles(ctx.sourceRecord, r.src).length;
        });
        let doneDl = 0;
        setProgressLine(2, '2. コピー元ファイルをダウンロード中… ' + (totalDl === 0 ? '対象ファイルなし' : 'ファイル 0/' + totalDl));
        for (const r of rows) {
          if (r.kind !== 'file') continue;
          const metas = getFieldFiles(ctx.sourceRecord, r.src);
          const arr = [];
          for (const m of metas) {
            currentFileName = m.name || '';
            setProgressLine(2, '2. コピー元ファイルをダウンロード中… ファイル ' + (doneDl + 1) + '/' + totalDl);
            const blob = await downloadFileBlob(m.fileKey, m.name);
            arr.push({ name: m.name, contentType: m.contentType || blob.type || '', blob: blob });
            doneDl++;
          }
          srcFilePack[r.dst] = arr;
        }
        setProgressLine(2, '2. コピー元ファイルをダウンロード中… 完了（ファイル ' + doneDl + '件）');
      } catch (eDl) {
        console.error('[app207_field_copy] ダウンロードエラー:', eDl);
        if (snapshotId != null) {
          try { await deleteSnapshot(snapshotId); } catch (e2) { console.warn(e2); }
        }
        closePopup();
        alert(MSG.E07(currentFileName || (eDl && eDl.message ? eDl.message : '不明'))); // E-07
        return;
      }

      // (d) アップロード(新fileKey発行=別ファイルとして複製)
      const uploadPack = {};
      try {
        let totalUp = 0;
        Object.keys(srcFilePack).forEach(function (k) {
          totalUp += srcFilePack[k].length;
        });
        let doneUp = 0;
        setProgressLine(3, '3. ファイルをアップロード中… ' + (totalUp === 0 ? '対象ファイルなし' : 'ファイル 0/' + totalUp));
        for (const dstCode of Object.keys(srcFilePack)) {
          const arr = [];
          const filesForField = srcFilePack[dstCode];
          for (let idx = 0; idx < filesForField.length; idx++) {
            const f = filesForField[idx];
            const key = dstCode + '__' + idx;
            const overrideName = (ctx.fileNameOverrides && ctx.fileNameOverrides[key]);
            const uploadName = (overrideName != null && overrideName !== '') ? overrideName : renameCopiedFileName(f.name, ctx);
            currentFileName = uploadName || f.name || '';
            setProgressLine(3, '3. ファイルをアップロード中… ファイル ' + (doneUp + 1) + '/' + totalUp);
            const newKey = await uploadFileBlob(f.blob, uploadName, f.contentType);
            arr.push({ fileKey: newKey });
            doneUp++;
          }
          uploadPack[dstCode] = arr;
        }
        setProgressLine(3, '3. ファイルをアップロード中… 完了（ファイル ' + doneUp + '件）');
      } catch (eUp) {
        console.error('[app207_field_copy] アップロードエラー:', eUp);
        if (snapshotId != null) {
          try { await deleteSnapshot(snapshotId); } catch (e2) { console.warn(e2); }
        }
        closePopup();
        alert(MSG.E08(currentFileName || (eUp && eUp.message ? eUp.message : '不明'))); // E-08
        return;
      }

      // (e) レコード更新(対象34フィールドのみ・revision指定=楽観ロック)
      setProgressLine(4, '4. レコードを更新中…');
      const updateRecord = {};
      rows.forEach(function (r) {
        if (r.kind === 'text') {
          updateRecord[r.dst] = { value: getFieldText(ctx.sourceRecord, r.src) };
        } else {
          updateRecord[r.dst] = { value: uploadPack[r.dst] || [] };
        }
      });
      let putResp = null;
      try {
        putResp = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', {
          app: ctx.appId,
          id: ctx.recordId,
          revision: ctx.currentRevision,
          record: updateRecord
        });
      } catch (ePut) {
        console.error('[app207_field_copy] レコード更新エラー:', ePut);
        if (snapshotId != null) {
          try { await deleteSnapshot(snapshotId); } catch (e2) { console.warn(e2); }
        }
        closePopup();
        const emsg = ePut && ePut.message ? ePut.message : String(ePut);
        const ecode = ePut && ePut.code ? ePut.code : '';
        if (ecode === 'GAIA_CO02' || /revision|リビジョン|最新ではありません/i.test(emsg)) {
          alert(MSG.E09); // E-09: 楽観ロック競合
        } else {
          alert(MSG.E10(emsg)); // E-10: その他の更新失敗
        }
        return;
      }
      setProgressLine(4, '4. レコードを更新中… 完了');

      // (f) スナップショットに更新後revisionを記録し、履歴を上限件数に整理
      if (snapshotId != null) {
        try {
          await updateSnapshotRevision(snapshotId, putResp && putResp.revision ? putResp.revision : '');
          await trimSnapshots(ctx.recordId, ctx.direction.to);
        } catch (eSnap) {
          console.warn('[app207_field_copy] スナップショット後処理の警告:', eSnap);
        }
      }
      renderComplete(ctx);
    } catch (eAll) {
      console.error('[app207_field_copy] 予期しないエラー:', eAll);
      if (snapshotId != null) {
        try { await deleteSnapshot(snapshotId); } catch (e2) { console.warn(e2); }
      }
      closePopup();
      alert(MSG.E04(eAll && eAll.message ? eAll.message : String(eAll)));
    }
  }

  // ---- [コピー前に戻す]ボタン押下 → 最新スナップショット確認 ----
  // fixedTarget: 'zenki'(move1のボタン) または 'kouki'(move2のボタン)
  async function onUndoButtonClick(btn, fixedTarget, undoLabelBase) {
    if (!dbAvailable) return;
    if (btn) btn.disabled = true;
    try {
      const recordId = String(getRecordId());
      const snap = await getLatestSnapshot(recordId, fixedTarget);
      if (!snap) {
        alert(MSG.E11); // E-11: 履歴なし
        return;
      }
      // 現在のrevisionを取得し、コピー直後から変更が入っていないか確認
      const cur = await kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', {
        app: getAppId(),
        id: recordId
      });
      const curRevision = cur.record.$revision.value;
      const mismatch = !!(snap.revisionAfterCopy && String(curRevision) !== String(snap.revisionAfterCopy));
      openPopup();
      renderUndoConfirm({ snap: snap, mismatch: mismatch, curRevision: curRevision, fixedTarget: fixedTarget });
    } catch (e) {
      console.error('[app207_field_copy] 戻す準備エラー:', e);
      alert(MSG.E04(e && e.message ? e.message : String(e)));
    } finally {
      if (btn) btn.disabled = false;
      const wrapId = fixedTarget === 'zenki' ? WRAP_ID_ZENKI : WRAP_ID_KOUKI;
      try { await refreshUndoButton(fixedTarget, wrapId, undoLabelBase); } catch (e2) { console.warn(e2); }
    }
  }

  // ---- Undo実行(バックアップBlobを再アップロードして復元) ----
  async function executeUndo(ctxU) {
    renderUndoProgress(ctxU);
    let currentFileName = '';
    try {
      const setDef = SET_DEF[ctxU.snap.targetSetKey];
      if (!setDef) {
        throw new Error('バックアップの対象セット情報が不正です（' + ctxU.snap.targetSetKey + '）');
      }
      // バックアップ時に選択されていた項目のみが snap.fields / snap.files に
      // 記録されているため、そのキーを実際の復元対象とする
      const files = ctxU.snap.files || {};
      const fields = ctxU.snap.fields || {};
      const fileCodes = Object.keys(files);
      const textCodes = Object.keys(fields);
      let total = 0;
      fileCodes.forEach(function (c) {
        total += (files[c] || []).length;
      });
      let done = 0;
      setProgressLine(1, '1. バックアップファイルをアップロード中… ' + (total === 0 ? '対象ファイルなし' : 'ファイル 0/' + total));
      const uploadPack = {};
      for (const code of fileCodes) {
        const arr = [];
        const list = files[code] || [];
        for (const f of list) {
          currentFileName = f.name || '';
          setProgressLine(1, '1. バックアップファイルをアップロード中… ファイル ' + (done + 1) + '/' + total);
          const key = await uploadFileBlob(f.blob, f.name, f.contentType);
          arr.push({ fileKey: key });
          done++;
        }
        uploadPack[code] = arr;
      }
      setProgressLine(1, '1. バックアップファイルをアップロード中… 完了（ファイル ' + total + '件）');
      const rec = {};
      textCodes.forEach(function (c) {
        rec[c] = { value: fields[c] };
      });
      fileCodes.forEach(function (c) {
        rec[c] = { value: uploadPack[c] || [] };
      });
      setProgressLine(2, '2. レコードを更新中…');
      await kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', {
        app: getAppId(),
        id: ctxU.snap.recordId,
        revision: ctxU.curRevision,
        record: rec
      });
      setProgressLine(2, '2. レコードを更新中… 完了');
      // 復元に成功したスナップショットは削除(LIFO消費)
      try { await deleteSnapshot(ctxU.snap.id); } catch (eDel) { console.warn(eDel); }
      renderUndoComplete(ctxU);
    } catch (e) {
      console.error('[app207_field_copy] 戻す実行エラー:', e);
      closePopup();
      const detail = (currentFileName ? 'ファイル: ' + currentFileName + ' / ' : '') + (e && e.message ? e.message : String(e));
      alert(MSG.E12(detail)); // E-12: 失敗時はバックアップを保持したまま
    }
  }

  // ---- [コピー前に戻す]ボタンの表示更新(残り件数) ----
  // wrapId配下の.a207fc-btn-undoを対象に、fixedTarget単位の残り件数を表示する
  async function refreshUndoButton(fixedTarget, wrapId, undoLabelBase) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const b = wrap.querySelector('.a207fc-btn-undo');
    if (!b) return;
    if (!dbAvailable) {
      b.style.display = 'none';
      return;
    }
    try {
      const n = await countSnapshots(String(getRecordId()), fixedTarget);
      if (n > 0) {
        b.disabled = false;
        b.textContent = undoLabelBase + '（残り' + n + '件）';
      } else {
        b.disabled = true;
        b.textContent = undoLabelBase;
      }
    } catch (e) {
      console.warn('[app207_field_copy] 履歴件数の取得に失敗:', e);
      b.disabled = true;
      b.textContent = undoLabelBase;
    }
  }

  // ---- 1つのスペース(move1/move2)にコピー・戻すボタンの組を設置 ----
  async function setupTargetButtons(fixedTarget, spaceId, wrapId, copyLabelBase, undoLabelBase) {
    if (!document.getElementById(wrapId)) {
      let mount = getSpaceEl(spaceId);
      if (!mount) {
        console.warn('[app207_field_copy] スペース要素「' + spaceId + '」が見つからないため、ヘッダー領域にボタンを設置します。フォーム設定でスペース(要素ID: ' + spaceId + ')の配置を確認してください。');
        mount = getHeaderEl();
      }
      if (!mount) {
        console.warn('[app207_field_copy] ボタンの設置先が見つからないため、初期化を中止しました。（' + spaceId + '）');
        return;
      }
      const wrap = document.createElement('div');
      wrap.id = wrapId;
      wrap.className = 'a207fc-btn-wrap';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'a207fc-btn-copy';
      copyBtn.textContent = copyLabelBase;
      copyBtn.onclick = function () { onCopyButtonClick(copyBtn, fixedTarget, copyLabelBase); };
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'a207fc-btn-undo';
      undoBtn.textContent = undoLabelBase;
      undoBtn.disabled = true;
      undoBtn.onclick = function () { onUndoButtonClick(undoBtn, fixedTarget, undoLabelBase); };
      wrap.appendChild(copyBtn);
      wrap.appendChild(undoBtn);
      mount.appendChild(wrap);
    }
    await refreshUndoButton(fixedTarget, wrapId, undoLabelBase);
  }

  // ---- ボタン設置(詳細画面表示時) ----
  // move1(前期用)・move2(後期用)の2箇所に、それぞれコピー・戻すボタンの組を設置する
  async function initButtons(eventType) {
    IS_MOBILE = String(eventType).indexOf('mobile.') === 0;
    injectStyles();
    await checkDbAvailable();

    await setupTargetButtons('zenki', CONFIG.SPACE_ID_ZENKI, WRAP_ID_ZENKI, LABEL_COPY_BTN_ZENKI, LABEL_UNDO_BASE_ZENKI);
    await setupTargetButtons('kouki', CONFIG.SPACE_ID_KOUKI, WRAP_ID_KOUKI, LABEL_COPY_BTN_KOUKI, LABEL_UNDO_BASE_KOUKI);

    if (dbAvailable) {
      try {
        await cleanupExpiredSnapshots(); // 期限切れ履歴の掃除(7日・前期/後期共通)
      } catch (e) {
        console.warn('[app207_field_copy] 期限切れ履歴の掃除に失敗:', e);
      }
    }
  }

  // ---- イベント登録(PC/モバイルの詳細画面) ----
  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    initButtons(event.type).catch(function (e) {
      console.error('[app207_field_copy] 初期化エラー:', e);
    });
    return event;
  });
})();
