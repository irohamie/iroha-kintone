/* =====================================================================
 * kintone アプリ231 担当表 一覧カスタマイズ  tantou_hyou.js
 * =====================================================================
 * 対象ビュー : <div id="tantou-root"></div>（1つのビューのみ）
 * 連携       : 利用者リスト（アプリ10）／職員マスタ（アプリ50）
 * ライブラリ : SortableJS（CDNから自動読込。URL登録は不要）
 * 認証       : kintone.api() セッション認証（APIトークン不使用）
 * ---------------------------------------------------------------------
 * 【機能一覧】
 *  1. 年度・月プルダウン＋事業所タブ（玉城・明和・訪問の3タブ。すべて別々に保存）
 *  2. 未設置枠＋職員列（社員ID昇順）のカンバン型担当表
 *  3. カードのドラッグ＆ドロップ（iPad/Android タッチ対応）
 *  4. 誕生日降順の自動ソート
 *  5. 学年バッジ（幼児=橙／小学生=青／中学生=緑／高校生=紫／成人=灰）
 *  6. カードへの施設名表示（幼児=園／小学生=小学校）
 *  7. 利用者ごとの備考欄
 *  8. 職員ごとの希望担当人数（玉城・明和のみ・全年月共通・職員マスタへ自動保存）
 *  9. 職員ごとの別タブ担当数の表示（例：明和3・訪問2）
 * 10. 訪問タブの内訳表示（玉城◯人・明和◯人の総数のみ）
 * 11. UNDO／REDO（保存までの一時履歴・カード移動が対象）
 * 12. 保存（assignment_data に JSON 保存・スタッフ欄も同時更新）
 * 13. 全体メモ（未設置列の下の自由記述・年月/事業所ごとに保存）
 * 14. スタッフ管理（職員マスタの在職者から追加・列の削除）
 * 15. 新規作成（過去月コピー／利用者リスト読込／空から開始 の3方式）
 * 16. 他月から読込（別の年度・月の担当表をこの月にコピー）
 * 17. 利用者リストへ反映（危険操作・二段階確認・確認前は一切書き込まない）
 * 18. 利用者リストから読込（担当を assignment_data へ書き出して保存）
 * ===================================================================== */
(function () {
  'use strict';

  /* ============================================================
   * ブロック1／4 : 設定・状態・共通ユーティリティ・CSS
   * ============================================================ */

  const CONFIG = {
    APP_CHILD: 10,                 // 利用者リスト
    APP_STAFF: 50,                 // 職員マスタ

    // 年度フィールドの保存形式
    //   'seireki' … 西暦の数値で保存（例: 2026年度 → 2026）
    //   'reiwa'   … 令和の数値で保存（例: 2026年度 → 8）
    NENDO_MODE: 'seireki',

    // アプリ231（担当表）のフィールドコード
    F231: {
      nendo: '年度',
      month: '月',
      office: '事業所',
      staff: 'スタッフ',
      data: 'assignment_data'
    },

    // 利用者リスト（アプリ10）のフィールドコード
    F10: {
      name: '児童氏名',
      status: '利用状況',
      place: '通所先',          // 通所ボードの絞り込みに使用
      visit: '訪問契約',        // 訪問ボードの絞り込みに使用（チェックボックス）
      grade: '学年',
      tantou: '担当',           // 通所ボードの反映先
      visitTantou: '訪問支援担当', // 訪問ボードの反映先
      birth: '誕生日',
      en: '園',                 // 幼児のカードに表示
      shogakko: '小学校'        // 小学生のカードに表示
    },

    // 職員マスタ（アプリ50）のフィールドコード
    F50: {
      empId: '社員ID',
      kubun: '区分',
      user: '氏名',
      desired: '希望担当人数'
    },

    ROOT_ID: 'tantou-root',         // カスタマイズビューに置く div の id（このIDのビューのみで起動）

    STATUS_ACTIVE: '利用中',
    KUBUN_RETIRED: '退職',

    // 学年バッジの分類に使うラベル（部分一致で判定する）
    YOJI_GRADES: ['0歳児', '1歳児', '2歳児', '年少', '年中', '年長'],
    SHO_GRADES: ['小1', '小2', '小3', '小4', '小5', '小6'],
    CHU_GRADES: ['中1', '中2', '中3'],
    KOU_GRADES: ['高1', '高2', '高3'],

    HISTORY_MAX: 100,

    // SortableJSの読み込み元。上から順に試し、最初に成功したものを使う。
    // 1つ目が読めない環境（回線制限やCDN障害）でも2つ目以降で救済する。
    SORTABLE_CDNS: [
      'https://js.cybozu.com/sortablejs/1.15.0/Sortable.min.js',
      'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js'
    ],

    // ---- タブ（事業所）定義 ----
    // 玉城／明和／訪問の3タブ。すべてレコード切替タブ＝それぞれ別々に保存する。
    // 玉城・明和とは絞り込みフィールド・反映先フィールドが異なる（訪問だけ専用）。
    //   value            : アプリ231「事業所」に保存する値（＝レコードの識別子）
    //   label            : タブに表示する文字
    //   childFilterField : 利用者リストの絞り込みに使うフィールド（F10のキー名）
    //   filterValues     : 絞り込みに使う値の配列
    //   targetField      : 利用者リストへ反映／読込する担当フィールド（F10のキー名）
    //   showDesiredCount : 希望担当人数の入力欄を表示するか
    OFFICES: [
      { value: '玉城', label: '玉城', childFilterField: 'place', filterValues: ['玉城'],
        targetField: 'tantou', showDesiredCount: true },
      { value: '明和', label: '明和', childFilterField: 'place', filterValues: ['明和'],
        targetField: 'tantou', showDesiredCount: true },
      { value: '訪問', label: '訪問', childFilterField: 'visit', filterValues: ['玉城', '明和'],
        targetField: 'visitTantou', showDesiredCount: false }
    ]
  };

  const state = {
    appId: null,
    nendo: null,                   // 年度（数値・NENDO_MODEに従う）
    month: null,                   // 月（1〜12）
    office: null,                  // 事業所（CONFIG.OFFICES[].value）
    recordId: null,                // 表示中のアプリ231レコードID
    staffMaster: new Map(),        // code -> {code,name,empId,retired,desiredCount,staffRecordId}
    staffNameFallback: new Map(),  // code -> 表示名（マスタ未登録時の予備）
    staffCodes: [],                // 現在の職員列（スタッフ欄の作業状態）
    children: [],                  // 対象児童（誕生日降順）
    crossCounts: new Map(),        // staffCode -> {事業所名: 人数}
    assignments: new Map(),        // childId -> staffCode | null
    notes: new Map(),              // childId -> 備考
    boardNote: '',                 // 全体メモ
    confirmed: false,              // 確定状態（レコードごとに保存される）
    history: [],                   // UNDO/REDO用スナップショット
    histIdx: -1,
    dirty: false,
    sortables: []
  };

  let loadingCount = 0;
  let toastTimer = null;
  let beforeUnloadRegistered = false;

  /* ---------- 汎用ユーティリティ ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // DOM生成ヘルパー（class/text/html/dataset/on〜イベントに対応）
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function getAppId() {
    try {
      if (kintone.app && typeof kintone.app.getId === 'function') {
        const id = kintone.app.getId();
        if (id != null) return id;
      }
    } catch (e) { /* noop */ }
    try {
      if (kintone.mobile && kintone.mobile.app && typeof kintone.mobile.app.getId === 'function') {
        const id2 = kintone.mobile.app.getId();
        if (id2 != null) return id2;
      }
    } catch (e2) { /* noop */ }
    return null;
  }

  function apiCall(path, method, params) {
    return kintone.api(kintone.api.url(path, true), method, params);
  }

  function errMsg(e) {
    if (!e) return '不明なエラー';
    let msg = e.message || '';
    if (e.code) msg += (msg ? '（' + e.code + '）' : e.code);
    if (e.errors) {
      try { msg += ' ' + JSON.stringify(e.errors); } catch (x) { /* noop */ }
    }
    return msg || String(e);
  }

  function uniq(arr) {
    const out = [];
    arr.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    return out;
  }

  // 全レコード取得（$idシーク方式・500件ずつ）
  async function fetchAllRecords(app, condition, fields) {
    const out = [];
    let lastId = 0;
    const flds = fields ? fields.concat(['$id']) : undefined;
    for (;;) {
      const q = (condition ? '(' + condition + ') and ' : '') + '$id > ' + lastId + ' order by $id asc limit 500';
      const params = { app: app, query: q };
      if (flds) params.fields = flds;
      const resp = await apiCall('/k/v1/records.json', 'GET', params);
      out.push.apply(out, resp.records);
      if (resp.records.length < 500) break;
      lastId = Number(resp.records[resp.records.length - 1].$id.value);
    }
    return out;
  }

  /* ---------- 年度・日付ユーティリティ ---------- */

  // 今日が属する年度の西暦（4月始まり）
  function fyOfToday() {
    const d = new Date();
    return (d.getMonth() + 1) >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  }
  function nendoValueFromFY(fy) {
    return CONFIG.NENDO_MODE === 'reiwa' ? fy - 2018 : fy;
  }
  function fyFromNendoValue(v) {
    return CONFIG.NENDO_MODE === 'reiwa' ? Number(v) + 2018 : Number(v);
  }
  function nendoLabel(v) {
    const fy = fyFromNendoValue(v);
    return CONFIG.NENDO_MODE === 'reiwa'
      ? 'R' + (fy - 2018) + '年度（' + fy + '年度）'
      : fy + '年度';
  }
  // 年度内の月順（4月=0 … 3月=11）
  function fiscalIdx(m) {
    return m >= 4 ? m - 4 : m + 8;
  }
  function sortKeyOf(r) {
    return fyFromNendoValue(r.nendo) * 100 + fiscalIdx(r.month);
  }
  // 前月（4月→前年度3月、1月→同年度12月）
  function prevMonthOf(nendo, month) {
    if (month === 4) return { nendo: nendo - 1, month: 3 };
    if (month === 1) return { nendo: nendo, month: 12 };
    return { nendo: nendo, month: month - 1 };
  }

  /* ---------- SortableJS ローダー ---------- */

  // SortableJSを確実に読み込む。scriptのonloadイベントだけに頼らず、
  // 実際に window.Sortable が現れたかをポーリングで確認する。
  // 1つ目のCDNがだめでも次のCDNを順に試す。
  // 複数回呼ばれても実ロードは1回だけ（_sortablePromiseをキャッシュ）。
  let _sortablePromise = null;

  function _waitForSortable(timeoutMs) {
    return new Promise(function (resolve, reject) {
      const start = Date.now();
      (function poll() {
        if (window.Sortable) { resolve(); return; }
        if (Date.now() - start > timeoutMs) { reject(new Error('timeout')); return; }
        setTimeout(poll, 100);
      })();
    });
  }

  function _loadOneCdn(url) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.setAttribute('data-tb-sortable', '1');
      let settled = false;
      s.onload = function () {
        // onload後、実際にSortableが使えるようになるまで最大3秒待つ
        _waitForSortable(3000).then(function () {
          if (!settled) { settled = true; resolve(); }
        }).catch(function () {
          if (!settled) { settled = true; reject(new Error('loaded but Sortable missing: ' + url)); }
        });
      };
      s.onerror = function () {
        if (!settled) { settled = true; reject(new Error('script error: ' + url)); }
      };
      document.head.appendChild(s);
    });
  }

  function ensureSortable() {
    if (window.Sortable) return Promise.resolve();
    if (_sortablePromise) return _sortablePromise;

    _sortablePromise = (async function () {
      // 既に読み込み済みのscriptタグがあれば、まずその出現を待ってみる
      if (document.querySelector('script[data-tb-sortable="1"]')) {
        try { await _waitForSortable(3000); return; } catch (e) { /* 次でCDNを試す */ }
      }
      const urls = CONFIG.SORTABLE_CDNS || [];
      let lastErr = null;
      for (let i = 0; i < urls.length; i++) {
        try {
          await _loadOneCdn(urls[i]);
          if (window.Sortable) return;   // 成功
        } catch (e) {
          lastErr = e;                   // このCDNは失敗 → 次のCDNへ
        }
      }
      _sortablePromise = null;           // 全滅した場合は次回リトライできるようにする
      throw (lastErr || new Error('SortableJS load failed'));
    })();

    return _sortablePromise;
  }

  /* ---------- CSS ---------- */

  function injectCss() {
    if (document.getElementById('tb-style')) return;
    const css = `
#tantou-root{margin:8px 0;}
.tb-wrap{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Noto Sans JP',Meiryo,sans-serif;color:#1E293B;background:#F1F5F9;border-radius:12px;padding:12px;position:relative;min-height:480px;box-sizing:border-box;}
.tb-wrap *{box-sizing:border-box;}
.tb-row1{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;}
.tb-row2{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}
.tb-summary-badge{font-size:12.5px;font-weight:600;border-radius:8px;padding:8px 14px;line-height:1.7;border:1px solid;color:#334155;}
#tb-office-summary{background:#EEF2FF;border-color:#C7D2FE;}
#tb-office-summary .tb-count-num{color:#4F46E5;}
#tb-yoji-summary{background:#F0FDFA;border-color:#99F6E4;}
#tb-yoji-summary .tb-count-num{color:#0D9488;}
#tb-sho-summary{background:#FDF2F8;border-color:#F9A8D4;}
#tb-sho-summary .tb-count-num{color:#DB2777;}
.tb-count-num{font-weight:800;margin:0 1px 0 2px;}
.tb-label{font-size:12px;color:#64748B;}
.tb-select{min-height:40px;font-size:15px;border:1px solid #CBD5E1;border-radius:8px;padding:6px 10px;background:#fff;color:#1E293B;}
.tb-tabs{display:flex;gap:6px;margin-left:6px;}
.tb-tab{min-height:40px;padding:0 20px;border-radius:999px;border:1px solid #CBD5E1;background:#fff;font-size:15px;font-weight:600;color:#475569;cursor:pointer;}
.tb-tab.tb-active{background:#1E293B;border-color:#1E293B;color:#fff;}
.tb-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}
.tb-btn{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;font-size:14px;font-weight:600;color:#334155;cursor:pointer;}
.tb-btn:disabled{opacity:.4;cursor:not-allowed;}
.tb-btn-save{background:#059669;border-color:#059669;color:#fff;font-weight:700;}
.tb-btn-save.tb-attn{box-shadow:0 0 0 3px #A7F3D0;}
.tb-btn-confirmed{background:#0F766E;border-color:#0F766E;color:#fff;font-weight:700;}
.tb-btn-primary{background:#4F46E5;border-color:#4F46E5;color:#fff;font-weight:700;}
.tb-btn-danger{background:#fff;border-color:#FCA5A5;color:#B91C1C;}
.tb-btn-danger-solid{background:#DC2626;border-color:#DC2626;color:#fff;font-weight:700;margin-left:auto;}
.tb-board-outer{position:relative;}
.tb-board{display:flex;gap:12px;overflow-x:auto;padding:4px 4px 16px;align-items:flex-start;-webkit-overflow-scrolling:touch;}
.tb-col{flex:0 0 252px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;display:flex;flex-direction:column;}
.tb-col-un{background:#FFF7ED;border-color:#FDBA74;position:sticky;left:0;z-index:5;box-shadow:4px 0 10px -6px rgba(15,23,42,.25);}
.tb-col-head{padding:10px 12px;border-bottom:1px solid #E2E8F0;}
.tb-col-title{font-weight:700;font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.tb-tag-cross{color:#0369A1;font-size:11px;border:1px solid #7DD3FC;background:#F0F9FF;border-radius:4px;padding:1px 5px;font-weight:600;}
.tb-tag-retired{color:#B91C1C;font-size:11px;border:1px solid #FCA5A5;border-radius:4px;padding:1px 5px;font-weight:600;}
.tb-tag-unknown{color:#92400E;font-size:11px;border:1px solid #FCD34D;background:#FFFBEB;border-radius:4px;padding:1px 5px;font-weight:600;}
.tb-col-sub{display:flex;align-items:center;gap:10px;margin-top:6px;font-size:12px;color:#64748B;flex-wrap:wrap;}
.tb-count{background:#EEF2FF;color:#3730A3;border-radius:999px;padding:2px 10px;font-weight:700;}
.tb-col-un .tb-count{background:#FFEDD5;color:#9A3412;}
.tb-desire{display:flex;align-items:center;gap:4px;}
.tb-desire input{width:64px;min-height:34px;border:1px solid #CBD5E1;border-radius:6px;padding:2px 6px;font-size:14px;text-align:right;background:#fff;}
.tb-list{padding:10px;display:flex;flex-direction:column;gap:8px;min-height:64px;flex:1;}
.tb-card{background:#fff;border:1px solid #E5E7EB;border-radius:10px;box-shadow:0 1px 2px rgba(15,23,42,.06);padding:8px 10px 8px 6px;display:flex;gap:6px;}
.tb-col-un .tb-card{border-color:#FED7AA;}
.tb-handle{flex:0 0 auto;color:#94A3B8;font-size:22px;line-height:1;padding:12px 10px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;border-radius:6px;align-self:stretch;display:flex;align-items:center;background:#F8FAFC;}
.tb-handle:active{cursor:grabbing;background:#E2E8F0;}
.tb-card-body{flex:1;min-width:0;}
.tb-card-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.tb-name{font-weight:700;font-size:14.5px;}
.tb-badge{font-size:11px;border-radius:999px;padding:2px 8px;font-weight:700;border:1px solid;}
.tb-badge-yoji{background:#FFEDD5;color:#9A3412;border-color:#FB923C;}
.tb-badge-sho{background:#DBEAFE;color:#1E40AF;border-color:#60A5FA;}
.tb-badge-chu{background:#D1FAE5;color:#065F46;border-color:#34D399;}
.tb-badge-kou{background:#EDE9FE;color:#5B21B6;border-color:#A78BFA;}
.tb-badge-adult{background:#E2E8F0;color:#334155;border-color:#94A3B8;}
.tb-badge-none{background:#F1F5F9;color:#64748B;border-color:#CBD5E1;}
.tb-inst{font-size:11.5px;color:#0F766E;background:#F0FDFA;border:1px solid #99F6E4;border-radius:4px;padding:1px 6px;margin-top:4px;display:inline-block;}
.tb-note{width:100%;margin-top:6px;border:1px solid #E2E8F0;border-radius:6px;padding:4px 6px;font-size:12.5px;color:#334155;background:#F8FAFC;resize:none;overflow:hidden;min-height:26px;line-height:1.45;font-family:inherit;}
.tb-note:focus{outline:2px solid #A5B4FC;background:#fff;}
.tb-ghost{opacity:.45;}
.tb-chosen{box-shadow:0 6px 16px rgba(15,23,42,.2);}
.tb-boardnote-wrap{padding:10px;border-top:1px solid #FDBA74;}
.tb-boardnote-label{font-size:12px;color:#9A3412;font-weight:700;margin-bottom:4px;}
.tb-boardnote{width:100%;border:1px solid #FDBA74;border-radius:8px;padding:8px;font-size:13px;line-height:1.6;color:#334155;background:#fff;resize:vertical;min-height:220px;font-family:inherit;box-sizing:border-box;overflow:hidden;}
.tb-boardnote:focus{outline:2px solid #FDBA74;}
.tb-empty-panel{background:#fff;border:2px dashed #CBD5E1;border-radius:14px;padding:36px 20px;text-align:center;color:#475569;}
.tb-empty-title{font-size:16px;font-weight:700;margin-bottom:6px;color:#1E293B;}
.tb-empty-panel p{margin:4px 0 16px;font-size:13px;line-height:1.7;}
.tb-loading{position:absolute;inset:0;background:rgba(241,245,249,.75);display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:50;border-radius:12px;font-size:13px;color:#334155;}
.tb-loading.tb-on{display:flex;}
.tb-spinner{width:34px;height:34px;border:4px solid #C7D2FE;border-top-color:#4F46E5;border-radius:50%;animation:tbspin .9s linear infinite;}
@keyframes tbspin{to{transform:rotate(360deg);}}
.tb-banner{border-radius:10px;padding:10px 12px;margin:0 0 8px;font-size:12.5px;line-height:1.6;}
.tb-banner-info{background:#EFF6FF;border:1px solid #BFDBFE;color:#1E3A8A;}
.tb-banner-warn{background:#FFFBEB;border:1px solid #FCD34D;color:#92400E;}
.tb-banner-error{background:#FEF2F2;border:1px solid #FCA5A5;color:#991B1B;}
.tb-banner-title{font-weight:700;margin-bottom:2px;}
.tb-banner ul{margin:4px 0 0;padding-left:18px;}
#tb-toast{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:1000;display:none;background:#1E293B;color:#fff;font-size:13.5px;padding:10px 18px;border-radius:999px;box-shadow:0 8px 20px rgba(15,23,42,.35);}
.tb-modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px;}
.tb-modal{background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(15,23,42,.35);}
.tb-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #E2E8F0;font-weight:700;font-size:15.5px;}
.tb-modal-x{border:none;background:none;font-size:20px;cursor:pointer;color:#64748B;padding:4px 8px;}
.tb-modal-body{padding:14px 16px;overflow-y:auto;font-size:13.5px;line-height:1.7;}
.tb-modal-foot{padding:12px 16px;border-top:1px solid #E2E8F0;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;}
.tb-staff-row{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px dashed #E2E8F0;}
.tb-staff-row .tb-staff-name{flex:1;font-weight:600;}
.tb-radio-block{border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:block;cursor:pointer;}
.tb-radio-block.tb-selected{border-color:#4F46E5;background:#EEF2FF;}
.tb-radio-block.tb-disabled{opacity:.5;cursor:not-allowed;}
.tb-radio-title{font-weight:700;display:flex;align-items:center;gap:6px;}
.tb-radio-desc{font-size:12px;color:#64748B;margin-top:2px;}
.tb-inline-controls{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.tb-modal-note{font-size:12px;color:#64748B;margin-top:10px;}
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'tb-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  /* ============================================================
   * ブロック2／4 : 表示部品・履歴・データ読込・JSON入出力
   * ============================================================ */

  /* ---------- ローディング・トースト ---------- */

  function showLoading(on) {
    loadingCount += on ? 1 : -1;
    if (loadingCount < 0) loadingCount = 0;
    const box = document.getElementById('tb-loading');
    if (box) box.classList.toggle('tb-on', loadingCount > 0);
  }

  function toast(msg) {
    const t = document.getElementById('tb-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, 3200);
  }

  /* ---------- メッセージ表示（それぞれポップアップで表示） ---------- */

  // メッセージは画面上部の帯ではなく、1件ずつポップアップで表示する。
  // 複数同時に発生した場合はキューに溜め、OKで閉じたら次を表示する。
  const _messageQueue = [];
  let _messagePopupOpen = false;

  function showBanner(kind, title, lines) {
    _messageQueue.push({ kind: kind, title: title, lines: lines || [] });
    _drainMessageQueue();
  }

  function _drainMessageQueue() {
    if (_messagePopupOpen) return;
    const next = _messageQueue.shift();
    if (!next) return;
    _messagePopupOpen = true;

    const body = el('div');
    const box = el('div', { class: 'tb-banner tb-banner-' + next.kind });
    box.appendChild(el('div', { class: 'tb-banner-title', text: next.title }));
    if (next.lines.length) {
      const ul = el('ul');
      next.lines.forEach(function (l) { ul.appendChild(el('li', { text: l })); });
      box.appendChild(ul);
    }
    body.appendChild(box);

    const kindLabel = { error: 'エラー', warn: '注意', info: 'お知らせ' }[next.kind] || 'お知らせ';
    openModal(kindLabel, body, [
      {
        label: 'OK', primary: true, onClick: function (close) {
          close();
          _messagePopupOpen = false;
          _drainMessageQueue();   // 次にキューがあれば続けて表示
        }
      }
    ]);
  }

  // 表示待ちのメッセージをすべて破棄する（開いているポップアップは閉じない）
  function clearBanners() {
    _messageQueue.length = 0;
  }

  function setDisabled(id, dis) {
    const b = document.getElementById(id);
    if (b) b.disabled = !!dis;
  }

  // 未保存状態の切替。保存ボタンを光らせて未保存であることを伝える。
  function markDirty(v) {
    state.dirty = !!v;
    const b = document.getElementById('tb-save');
    if (b) b.classList.toggle('tb-attn', state.dirty && !!state.recordId);
  }

  /* ---------- 履歴（UNDO/REDO・カード移動のみ対象） ---------- */

  function snapshotAssignments() {
    const o = {};
    state.assignments.forEach(function (v, k) { o[k] = v; });
    return o;
  }

  function restoreSnapshot(o) {
    const m = new Map();
    Object.keys(o).forEach(function (k) { m.set(k, o[k]); });
    state.assignments = m;
  }

  function resetHistory() {
    state.history = [snapshotAssignments()];
    state.histIdx = 0;
    updateUndoButtons();
  }

  function pushHistory() {
    state.history = state.history.slice(0, state.histIdx + 1);
    state.history.push(snapshotAssignments());
    if (state.history.length > CONFIG.HISTORY_MAX) state.history.shift();
    state.histIdx = state.history.length - 1;
    updateUndoButtons();
  }

  function undo() {
    if (state.histIdx <= 0) return;
    state.histIdx--;
    restoreSnapshot(state.history[state.histIdx]);
    markDirty(true);
    renderBoard();
  }

  function redo() {
    if (state.histIdx >= state.history.length - 1) return;
    state.histIdx++;
    restoreSnapshot(state.history[state.histIdx]);
    markDirty(true);
    renderBoard();
  }

  function updateUndoButtons() {
    setDisabled('tb-undo', !state.recordId || state.histIdx <= 0);
    setDisabled('tb-redo', !state.recordId || state.histIdx >= state.history.length - 1);
  }

  // 児童の「有効な」担当（職員列に存在しない割当は未設置扱い）
  function effectiveStaffOf(childId) {
    const code = state.assignments.get(childId);
    if (!code) return null;
    return state.staffCodes.indexOf(code) >= 0 ? code : null;
  }

  /* ---------- 職員マスタ ---------- */

  // アプリ50（職員マスタ）読込。同一ユーザーが複数行ある場合は在職を優先する。
  async function loadStaffMaster() {
    const F = CONFIG.F50;
    const recs = await fetchAllRecords(CONFIG.APP_STAFF, null, [F.empId, F.kubun, F.user, F.desired]);
    state.staffMaster = new Map();
    recs.forEach(function (r) {
      const users = (r[F.user] && r[F.user].value) || [];
      if (!users.length) return;
      const u = users[0];
      const empRaw = r[F.empId] ? r[F.empId].value : null;
      const emp = (empRaw === '' || empRaw == null) ? null : Number(empRaw);
      const retired = ((r[F.kubun] && r[F.kubun].value) || '') === CONFIG.KUBUN_RETIRED;
      const desRaw = r[F.desired] ? r[F.desired].value : null;
      const desired = (desRaw === '' || desRaw == null) ? null : Number(desRaw);
      if (!state.staffMaster.has(u.code) || !retired) {
        state.staffMaster.set(u.code, {
          code: u.code,
          name: u.name,
          empId: emp,
          retired: retired,
          desiredCount: desired,
          staffRecordId: String(r.$id.value)
        });
      }
    });
  }

  // 希望担当人数（全年月共通）を更新する。
  // 担当表の「保存」ボタンとは無関係に、入力した少し後に職員マスタへ直接書き込む。
  const _desiredSaveTimers = new Map();
  function updateStaffDesiredCount(code, value) {
    const info = staffInfo(code);
    info.desiredCount = value;   // 画面表示用に即時反映
    if (_desiredSaveTimers.has(code)) clearTimeout(_desiredSaveTimers.get(code));
    const timer = setTimeout(function () {
      _desiredSaveTimers.delete(code);
      if (!info.staffRecordId) return;   // 職員マスタに実レコードが無い場合は保存しない
      const rec = {};
      rec[CONFIG.F50.desired] = { value: (value == null ? '' : String(value)) };
      apiCall('/k/v1/record.json', 'PUT', { app: CONFIG.APP_STAFF, id: info.staffRecordId, record: rec })
        .catch(function (e) {
          showBanner('error', '希望担当人数の保存に失敗しました', [staffInfo(code).name + '：' + errMsg(e)]);
        });
    }, 600);   // 入力中の連続保存を避けるための待ち時間
    _desiredSaveTimers.set(code, timer);
  }

  function staffInfo(code) {
    const m = state.staffMaster.get(code);
    if (m) return m;
    return {
      code: code,
      name: state.staffNameFallback.get(code) || code,
      empId: null,
      retired: false,
      desiredCount: null,
      staffRecordId: null,
      unknown: true
    };
  }

  // 社員ID昇順（未登録は最後）→ 名前順
  function sortStaffCodes(codes) {
    return codes.slice().sort(function (a, b) {
      const ia = staffInfo(a);
      const ib = staffInfo(b);
      const ea = ia.empId == null ? Number.MAX_SAFE_INTEGER : ia.empId;
      const eb = ib.empId == null ? Number.MAX_SAFE_INTEGER : ib.empId;
      if (ea !== eb) return ea - eb;
      return ia.name.localeCompare(ib.name, 'ja');
    });
  }

  function orderedStaffCodes() {
    return sortStaffCodes(state.staffCodes);
  }

  /* ---------- 児童（利用者）読込 ---------- */

  // 現在表示中の事業所の設定を取得
  function currentOfficeConf() {
    const hit = CONFIG.OFFICES.filter(function (o) { return o.value === state.office; });
    return hit.length ? hit[0] : CONFIG.OFFICES[0];
  }

  // 対象児童を読み込む。
  //   玉城／明和タブ：利用状況=利用中 かつ 通所先=表示中の事業所
  //   訪問タブ    ：利用状況=利用中 かつ 訪問契約に玉城または明和のチェックあり
  async function loadChildren() {
    const F = CONFIG.F10;
    const conf = currentOfficeConf();
    const filterCode = F[conf.childFilterField];
    const targetCode = F[conf.targetField];
    const values = conf.filterValues.map(function (v) { return '"' + v + '"'; }).join(',');
    const cond = F.status + ' in ("' + CONFIG.STATUS_ACTIVE + '") and ' + filterCode + ' in (' + values + ')';
    // 訪問タブでは、絞り込みに使うチェックボックス自体の値（どちらの事業所にチェックが
    // あるか）も取得しておく。内訳（玉城◯人・明和◯人）の集計に使うため。
    const fields = [F.name, F.grade, F.birth, F.en, F.shogakko, targetCode];
    if (fields.indexOf(filterCode) === -1) fields.push(filterCode);
    const recs = await fetchAllRecords(CONFIG.APP_CHILD, cond, fields);
    state.children = recs.map(function (r) {
      const tantou = (r[targetCode] && r[targetCode].value) || [];
      const filterVals = (r[filterCode] && r[filterCode].value) || [];
      return {
        id: String(r.$id.value),
        name: (r[F.name] && r[F.name].value) || '（氏名未設定）',
        birth: (r[F.birth] && r[F.birth].value) || '',
        grade: (r[F.grade] && r[F.grade].value) || '',
        en: (r[F.en] && r[F.en].value) || '',
        shogakko: (r[F.shogakko] && r[F.shogakko].value) || '',
        filterValues: filterVals,   // 訪問タブの内訳集計で使用（例：['玉城']）
        tantouCodes: tantou.map(function (u) { return u.code; }),
        tantouNames: tantou.map(function (u) { return u.name; })
      };
    });
    state.children.sort(childSortFn);
  }

  // ラベルと件数を「ラベル<b class="tb-count-num">件数</b>」の形でHTML化する共通ヘルパー。
  // ラベルと数字の境目が分かりにくい問題（例：「小1」+「36」→「小136」に見える）を、
  // 数字部分の色・太さを変えることで解消する。
  function _breakdownPartHtml(label, count) {
    return esc(label) + '<b class="tb-count-num">' + count + '</b>';
  }

  // 訪問タブでの内訳（玉城◯人・明和◯人）をHTMLで組み立てる。玉城／明和タブでは使わない。
  function visitBreakdownHtml() {
    if (state.office !== '訪問') return '';
    let tamaki = 0, akewa = 0;
    state.children.forEach(function (c) {
      const vals = c.filterValues || [];
      if (vals.indexOf('玉城') !== -1) tamaki++;
      if (vals.indexOf('明和') !== -1) akewa++;
    });
    return _breakdownPartHtml('玉城', tamaki) + '人・' + _breakdownPartHtml('明和', akewa) + '人';
  }

  // 表示順（この順番で件数がある区分だけを並べる）。幼児区分／小学生以上区分の2つに分ける。
  const YOJI_BREAKDOWN_ORDER = ['0歳', '1歳', '2歳', '年少', '年中', '年長'];
  const SHO_PLUS_BREAKDOWN_ORDER = ['小1', '小2', '小3', '小4', '小5', '小6', '中学生以上', '未設定'];

  // 学年内訳のグループ集計を組み立てる共通処理。
  //   groupLabel … バッジ冒頭に出すグループ名（例：'幼児'）
  //   order      … 集計対象のラベル一覧（この順で件数がある区分だけを並べる）
  // 戻り値： 'グループ名<合計人数>人：ラベル<件数>・ラベル<件数>…' または該当者0人なら空文字
  function _gradeGroupHtml(groupLabel, order) {
    const counts = {};
    state.children.forEach(function (c) {
      const label = classifyGradeDetailed(c.grade).label;
      counts[label] = (counts[label] || 0) + 1;
    });
    let total = 0;
    const parts = [];
    order.forEach(function (label) {
      if (counts[label]) {
        total += counts[label];
        parts.push(_breakdownPartHtml(label, counts[label]));
      }
    });
    if (!total) return '';
    return esc(groupLabel) + '<b class="tb-count-num">' + total + '</b>' + '人：' + parts.join('・');
  }

  // 幼児区分（0歳〜年長）の内訳をHTMLで組み立てる。全タブ共通で使用する。
  function gradeBreakdownYojiHtml() {
    return _gradeGroupHtml('幼児', YOJI_BREAKDOWN_ORDER);
  }

  // 小学生以上区分（小1〜中学生以上）の内訳をHTMLで組み立てる。全タブ共通で使用する。
  function gradeBreakdownShoPlusHtml() {
    return _gradeGroupHtml('小学生以上', SHO_PLUS_BREAKDOWN_ORDER);
  }

  // 誕生日降順（新しい子が上）。未登録は最後。同日は名前順。
  function childSortFn(a, b) {
    if (a.birth && b.birth) {
      if (a.birth < b.birth) return 1;
      if (a.birth > b.birth) return -1;
      return a.name.localeCompare(b.name, 'ja');
    }
    if (a.birth) return -1;
    if (b.birth) return 1;
    return a.name.localeCompare(b.name, 'ja');
  }

  /* ---------- 別ボードの担当数集計 ---------- */

  // 同じ年度・月の「表示中以外の全ボード」（通所・玉城／通所・明和／訪問 のうち
  // 今見ていないもの）のアプリ231レコードだけを読み、その assignment_data の
  // 担当割当を職員ごとに数える。利用者リスト全件は読まないので高速。
  async function loadCrossOfficeCounts() {
    const F = CONFIG.F231;
    state.crossCounts = new Map();
    const others = CONFIG.OFFICES.map(function (o) { return o.value; }).filter(function (o) { return o !== state.office; });
    if (!others.length) return;
    const officeQuery = others.map(function (o) { return '"' + o + '"'; }).join(',');
    const q = F.nendo + ' = ' + state.nendo +
      ' and ' + F.month + ' = ' + state.month +
      ' and ' + F.office + ' in (' + officeQuery + ')';
    const resp = await apiCall('/k/v1/records.json', 'GET', {
      app: state.appId, query: q, fields: [F.office, F.data]
    });
    resp.records.forEach(function (r) {
      const place = (r[F.office] && r[F.office].value) || '';
      if (!place) return;
      const json = parseAssignmentData((r[F.data] && r[F.data].value) || '');
      (json.assignments || []).forEach(function (a) {
        if (!a || !a.staffCode) return;
        const code = String(a.staffCode);
        if (!state.crossCounts.has(code)) state.crossCounts.set(code, {});
        const m = state.crossCounts.get(code);
        m[place] = (m[place] || 0) + 1;
      });
    });
  }

  // 別ボードの担当数を「明和3・訪問2」のような文字列にする（無ければ空文字）
  function crossCountLabel(code) {
    const m = state.crossCounts.get(code);
    if (!m) return '';
    const parts = [];
    Object.keys(m).forEach(function (place) {
      if (m[place] > 0) parts.push(place + m[place]);
    });
    return parts.join('・');
  }

  /* ---------- アプリ231レコードの検索・JSON入出力 ---------- */

  // 表示中の年度・月・事業所のアプリ231レコードを検索
  async function searchBoardRecord() {
    const F = CONFIG.F231;
    const q = F.nendo + ' = ' + state.nendo +
      ' and ' + F.month + ' = ' + state.month +
      ' and ' + F.office + ' in ("' + state.office + '") order by $id asc limit 1';
    const resp = await apiCall('/k/v1/records.json', 'GET', { app: state.appId, query: q });
    return resp.records.length ? resp.records[0] : null;
  }

  // assignment_data（JSON文字列）の安全な解析
  function parseAssignmentData(s) {
    if (!s) return { assignments: [] };
    try {
      const j = JSON.parse(s);
      if (j && typeof j === 'object') return j;
    } catch (e) {
      showBanner('warn', 'データの読み取りに失敗しました',
        ['保存内容をJSONとして読み取れなかったため、空の状態として扱います。保存すると正しい形式で上書きされます。']);
    }
    return { assignments: [] };
  }

  // 保存用JSONの組み立て（画面の表示内容が正）。
  // ※希望担当人数は職員マスタ側で全年月共通に管理するため、ここには含めない。
  function buildAssignmentJson() {
    return {
      version: 2,
      savedAt: new Date().toISOString(),
      nendo: state.nendo,
      month: state.month,
      office: state.office,
      boardNote: state.boardNote || '',
      confirmed: !!state.confirmed,
      assignments: state.children.map(function (c) {
        return {
          childId: c.id,
          childName: c.name,
          staffCode: effectiveStaffOf(c.id),
          note: state.notes.get(c.id) || ''
        };
      })
    };
  }

  // 検索結果のレコードを作業状態へ反映する（null=レコード未作成）
  function applyLoadedRecord(rec) {
    state.assignments = new Map();
    state.notes = new Map();
    state.boardNote = '';
    state.confirmed = false;
    if (!rec) {
      state.recordId = null;
      state.staffCodes = [];
      resetHistory();
      state.dirty = false;
      return;
    }
    const F = CONFIG.F231;
    state.recordId = String(rec.$id.value);
    const staffField = (rec[F.staff] && rec[F.staff].value) || [];
    state.staffCodes = staffField.map(function (u) {
      if (u.name) state.staffNameFallback.set(u.code, u.name);
      return u.code;
    });

    const json = parseAssignmentData((rec[F.data] && rec[F.data].value) || '');
    state.boardNote = json.boardNote || '';
    state.confirmed = !!json.confirmed;

    const byChild = {};
    (json.assignments || []).forEach(function (a) {
      if (a && a.childId != null) byChild[String(a.childId)] = a;
    });

    // 現在の表示条件に一致しない児童データ（退所・条件変更など）の件数を数える
    const childIds = {};
    state.children.forEach(function (c) { childIds[c.id] = true; });
    let stale = 0;
    Object.keys(byChild).forEach(function (id) {
      if (!childIds[id]) {
        const a = byChild[id];
        if (a.staffCode || a.note) stale++;
      }
    });

    // スタッフ欄に無い担当者が保存データに残っていた場合、列として自動復元する
    const autoAdded = [];
    state.children.forEach(function (c) {
      const a = byChild[c.id];
      const code = (a && a.staffCode) ? String(a.staffCode) : null;
      state.assignments.set(c.id, code);
      state.notes.set(c.id, (a && a.note) || '');
      if (code && state.staffCodes.indexOf(code) === -1) {
        state.staffCodes.push(code);
        autoAdded.push(staffInfo(code).name);
      }
    });

    resetHistory();
    state.dirty = false;

    if (autoAdded.length) {
      showBanner('info', 'スタッフ欄に無い担当者を列として自動表示しています（保存すると確定します）', uniq(autoAdded));
    }
    if (stale) {
      showBanner('info', '表示対象外の児童データがあります', [
        '前回保存分のうち ' + stale + '人分は、現在の表示条件（' +
        currentOfficeConf().label +
        '）に一致しないため表示していません。次回保存時に整理されます。'
      ]);
    }
  }

  /* ============================================================
   * ブロック3／4 : 画面構築・ボード描画・DnD・モーダル基盤
   * ============================================================ */

  /* ---------- 学年の判定 ---------- */

  // 全角数字（０-９）を半角数字（0-9）に変換する。
  // 学年フィールドの値が全角数字で入っていても判定が一致するようにするため
  // （表示テキストには使わず、判定用の内部比較にのみ使用する）。
  function _normalizeDigits(s) {
    return String(s).replace(/[０-９]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
  }

  // 学年の値を詳しく分類する。{kind, label} を返す。
  //   kind  … バッジの色分けに使う区分（'none'|'yoji'|'sho'|'chu'|'kou'|'adult'）
  //   label … 学年内訳の集計に使うラベル（スペース節約のため「0歳児」ではなく「0歳」、
  //           中1〜高3・成人は「中学生以上」にまとめて表記する）
  function classifyGradeDetailed(g) {
    if (!g) return { kind: 'none', label: '未設定' };
    const gn = _normalizeDigits(g);
    // 「2歳」のように「児」が付かない単独の1桁年齢表記も、下の全角チェックと同様に扱う。
    // 先頭が0・1・2で直後が「歳」の場合のみ対象（"12歳"は2文字目が"2"なので一致しない）。
    const bare = gn.match(/^([0-2])歳/);
    if (bare) return { kind: 'yoji', label: bare[1] + '歳' };
    if (gn.indexOf('0歳児') !== -1) return { kind: 'yoji', label: '0歳' };
    if (gn.indexOf('1歳児') !== -1) return { kind: 'yoji', label: '1歳' };
    if (gn.indexOf('2歳児') !== -1) return { kind: 'yoji', label: '2歳' };
    for (let i = 0; i < CONFIG.YOJI_GRADES.length; i++) {
      const lb = CONFIG.YOJI_GRADES[i];
      if (lb.indexOf('歳児') !== -1) continue;   // 0/1/2歳児は上で処理済み
      if (gn.indexOf(lb) !== -1) return { kind: 'yoji', label: lb };
    }
    for (let i = 0; i < CONFIG.SHO_GRADES.length; i++) {
      if (gn.indexOf(CONFIG.SHO_GRADES[i]) !== -1) return { kind: 'sho', label: CONFIG.SHO_GRADES[i] };
    }
    // 中1〜高3・成人（＝「◯歳」表記や想定外の値）は、内訳表示ではまとめて「中学生以上」にする。
    // ※バッジの色（kind）は引き続き chu/kou/adult でそれぞれ区別する（カードの色分けには影響しない）。
    for (let i = 0; i < CONFIG.CHU_GRADES.length; i++) {
      if (gn.indexOf(CONFIG.CHU_GRADES[i]) !== -1) return { kind: 'chu', label: '中学生以上' };
    }
    for (let i = 0; i < CONFIG.KOU_GRADES.length; i++) {
      if (gn.indexOf(CONFIG.KOU_GRADES[i]) !== -1) return { kind: 'kou', label: '中学生以上' };
    }
    return { kind: 'adult', label: '中学生以上' };   // 「◯歳」表記、または想定外の値の保険
  }

  // 学年の値を分類する（バッジの色分け・施設名の判定で共用）。
  // 戻り値： 'none' | 'yoji' | 'sho' | 'chu' | 'kou' | 'adult'
  function classifyGrade(g) {
    return classifyGradeDetailed(g).kind;
  }

  function gradeBadge(g) {
    const kind = classifyGrade(g);
    const clsMap = {
      none: 'tb-badge-none', yoji: 'tb-badge-yoji', sho: 'tb-badge-sho',
      chu: 'tb-badge-chu', kou: 'tb-badge-kou', adult: 'tb-badge-adult'
    };
    const text = (kind === 'none') ? '学年未設定' : g;
    return el('span', { class: 'tb-badge ' + clsMap[kind], text: text });
  }

  // 学年区分に応じた施設名を返す。幼児=園、小学生=小学校。
  // 中学生・高校生・成人・未設定、および値が空欄の場合は空文字（＝表示しない）。
  function institutionName(c) {
    const kind = classifyGrade(c.grade);
    if (kind === 'yoji') return c.en || '';
    if (kind === 'sho') return c.shogakko || '';
    return '';
  }

  /* ---------- カード・列の部品 ---------- */

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  function buildCard(c) {
    const handle = el('span', { class: 'tb-handle', text: '⠿', 'aria-label': 'ドラッグして移動' });
    const top = el('div', { class: 'tb-card-top' }, [
      el('span', { class: 'tb-name', text: c.name }),
      gradeBadge(c.grade)
    ]);
    const bodyChildren = [top];

    // 学年に応じた施設名（園・小学校）を1行追加する
    const inst = institutionName(c);
    if (inst) bodyChildren.push(el('div', { class: 'tb-inst', text: inst }));

    const body = el('div', { class: 'tb-card-body' }, bodyChildren);

    const ta = el('textarea', { class: 'tb-note', rows: '1', placeholder: '備考' });
    ta.value = state.notes.get(c.id) || '';
    ta.addEventListener('input', function () {
      state.notes.set(c.id, ta.value);
      markDirty(true);
      autoGrow(ta);
    });
    body.appendChild(ta);

    return el('div', { class: 'tb-card', dataset: { childId: c.id } }, [handle, body]);
  }

  // code=null で「未設置」列、それ以外は職員列
  function buildColumn(code) {
    const isUn = (code === null);
    const kids = state.children.filter(function (c) { return effectiveStaffOf(c.id) === code; });

    const title = el('div', { class: 'tb-col-title' });
    if (isUn) {
      title.appendChild(el('span', { text: '未設置' }));
    } else {
      const info = staffInfo(code);
      title.appendChild(el('span', { text: info.name }));
      const cross = crossCountLabel(code);
      if (cross) title.appendChild(el('span', { class: 'tb-tag-cross', text: '別担当 ' + cross }));
      if (info.retired) title.appendChild(el('span', { class: 'tb-tag-retired', text: '退職' }));
      if (info.unknown) title.appendChild(el('span', { class: 'tb-tag-unknown', text: 'マスタ未登録' }));
    }

    const sub = el('div', { class: 'tb-col-sub' });
    sub.appendChild(el('span', { class: 'tb-count', text: kids.length + '人' }));

    // 希望担当人数の入力欄（通所ボードのみ表示。訪問ボードでは出さない）
    if (!isUn && currentOfficeConf().showDesiredCount) {
      const wrap = el('span', { class: 'tb-desire' });
      wrap.appendChild(el('span', { text: '希望' }));
      const inp = el('input', { type: 'number', min: '0', inputmode: 'numeric' });
      const cur = staffInfo(code).desiredCount;
      if (cur != null) inp.value = cur;
      inp.title = '全ての年月で共通の値です（担当表の「保存」ボタンとは関係なく、入力すると自動で保存されます）';
      inp.addEventListener('input', function () {
        const v = (inp.value === '') ? null : Number(inp.value);
        updateStaffDesiredCount(code, v);
      });
      wrap.appendChild(inp);
      wrap.appendChild(el('span', { text: '人' }));
      sub.appendChild(wrap);
    }

    const head = el('div', { class: 'tb-col-head' }, [title, sub]);
    const list = el('div', { class: 'tb-list', dataset: { staffCode: code || '' } });
    kids.forEach(function (k) { list.appendChild(buildCard(k)); });

    const colChildren = [head, list];

    // 未設置列の下に全体メモを配置
    if (isUn) {
      const noteWrap = el('div', { class: 'tb-boardnote-wrap' });
      noteWrap.appendChild(el('div', { class: 'tb-boardnote-label', text: '全体メモ（この年月・事業所の共有メモ）' }));
      const bn = el('textarea', { class: 'tb-boardnote', placeholder: '全体に関わる連絡・申し送りなど、自由に記入できます' });
      bn.value = state.boardNote || '';
      bn.addEventListener('input', function () {
        state.boardNote = bn.value;
        markDirty(true);
        autoGrow(bn);
      });
      noteWrap.appendChild(bn);
      colChildren.push(noteWrap);
      // 既存の内容量に応じて初期の高さを合わせる
      setTimeout(function () { autoGrow(bn); }, 0);
    }

    return el('div', { class: 'tb-col' + (isUn ? ' tb-col-un' : '') }, colChildren);
  }

  function renderEmptyPanel(container) {
    container.innerHTML = '';
    const p = el('div', { class: 'tb-empty-panel' });
    p.appendChild(el('div', {
      class: 'tb-empty-title',
      text: nendoLabel(state.nendo) + ' ' + state.month + '月・' +
            currentOfficeConf().label + ' の担当表はまだありません'
    }));
    p.appendChild(el('p', {
      text: '「＋ 新規作成」を押すと、過去月のコピー／利用者リストの現在の担当の読み込み／空の状態、の3つから作成方法を選べます。'
    }));
    const btn = el('button', { class: 'tb-btn tb-btn-primary', type: 'button', text: '＋ 新規作成' });
    btn.addEventListener('click', function () { openNewRecordModal(); });
    p.appendChild(btn);
    container.appendChild(p);
  }

  /* ---------- ボード描画 ---------- */

  function renderBoard() {
    destroySortables();
    const board = document.getElementById('tb-board');
    const empty = document.getElementById('tb-empty');
    if (!board || !empty) return;
    board.innerHTML = '';

    if (!state.recordId) {
      board.style.display = 'none';
      renderEmptyPanel(empty);
      empty.style.display = 'block';
      refreshToolbar();
      return;
    }

    empty.style.display = 'none';
    board.style.display = 'flex';
    board.appendChild(buildColumn(null));
    orderedStaffCodes().forEach(function (code) {
      board.appendChild(buildColumn(code));
    });
    initSortables();
    board.querySelectorAll('textarea.tb-note').forEach(function (ta) { autoGrow(ta); });
    refreshToolbar();
  }

  function initSortables() {
    if (!window.Sortable) return;
    document.querySelectorAll('#tb-board .tb-list').forEach(function (listEl) {
      state.sortables.push(new Sortable(listEl, {
        group: 'tantou-board',
        sort: false,                 // 列内の並び替えは無効（誕生日順に自動整列するため）
        handle: '.tb-handle',
        animation: 150,
        delay: 150,                  // 長押しでドラッグ開始（画面の横スクロールと共存させる）
        delayOnTouchOnly: true,      // タッチ操作のときだけ遅延を適用
        touchStartThreshold: 8,      // この距離までの指の揺れはタップ扱い
        forceFallback: true,         // Android等でネイティブDnDが不安定なためJS制御に統一
        fallbackTolerance: 5,
        fallbackOnBody: true,
        scroll: true,                // ドラッグ中の自動スクロール
        ghostClass: 'tb-ghost',
        chosenClass: 'tb-chosen',
        onAdd: function (evt) {
          const childId = evt.item.getAttribute('data-child-id');
          const dest = evt.to.getAttribute('data-staff-code') || null;
          state.assignments.set(childId, dest);
          pushHistory();
          markDirty(true);
          setTimeout(renderBoard, 0);   // ドロップ完了後に再描画（誕生日順に整列）
        }
      }));
    });
  }

  function destroySortables() {
    state.sortables.forEach(function (s) {
      try { s.destroy(); } catch (e) { /* noop */ }
    });
    state.sortables = [];
  }

  function refreshToolbar() {
    const has = !!state.recordId;
    setDisabled('tb-save', !has);
    setDisabled('tb-staff', !has);
    setDisabled('tb-push', !has);
    setDisabled('tb-confirm', !has);
    updateUndoButtons();
    updateConfirmUI();
  }

  // 確定ボタンの見た目と、一括読み込みボタン（利用者リストから読込／他月から読込）の
  // 表示・非表示を、確定状態(state.confirmed)に応じて更新する。
  function updateConfirmUI() {
    const has = !!state.recordId;
    const btn = document.getElementById('tb-confirm');
    if (btn) {
      btn.textContent = state.confirmed ? '確定を解除' : '確定';
      btn.classList.toggle('tb-btn-confirmed', !!state.confirmed);
    }
    const bImport = document.getElementById('tb-import');
    const bImportMonth = document.getElementById('tb-importmonth');
    const hideBulk = has && state.confirmed;
    if (bImport) bImport.style.display = hideBulk ? 'none' : '';
    if (bImportMonth) bImportMonth.style.display = hideBulk ? 'none' : '';
    setDisabled('tb-import', !has);
    setDisabled('tb-importmonth', !has);
  }

  // 「確定」ボタンの押下処理。
  //   未確定→確定：警告ポップアップで確認したうえで確定し、その場で保存する
  //     （確定すると一括読み込みボタンが非表示になり、誤った上書きを防止する）
  //   確定→未確定：解除は即座に行う（データが失われる操作ではないため）
  function onConfirmToggle() {
    if (!state.recordId) return;
    if (state.confirmed) {
      state.confirmed = false;
      markDirty(true);
      updateConfirmUI();
      doSave();   // 解除も即座に保存し、他の画面から見ても解除済みの状態にする
      return;
    }

    const body = el('div');
    body.appendChild(el('div', {
      class: 'tb-banner tb-banner-warn',
      html: '<b>この担当表を確定します。</b><br>確定すると「利用者リストから読込」「他月から読込」ボタンが非表示になり、' +
            '誤って一括で上書きされることを防ぎます。<br>後からいつでも「確定を解除」で元に戻せます。'
    }));
    body.appendChild(el('div', {
      class: 'tb-modal-note',
      text: '現在の内容がそのまま保存されます。内容をご確認のうえ、確定してください。'
    }));

    openModal('担当表を確定しますか？', body, [
      { label: 'キャンセル', onClick: function (close) { close(); } },
      {
        label: '確定する', primary: true, onClick: function (close, btn) {
          btn.disabled = true;
          state.confirmed = true;
          updateConfirmUI();
          doSave().then(function () {
            close();
          });
        }
      }
    ]);
  }

  /* ---------- 汎用モーダル ---------- */

  function openModal(title, bodyNode, buttons) {
    const layer = document.getElementById('tb-modal-layer');
    if (!layer) return function () {};
    const head = el('div', { class: 'tb-modal-head' }, [el('span', { text: title })]);
    const x = el('button', { class: 'tb-modal-x', type: 'button', text: '×' });
    head.appendChild(x);
    const body = el('div', { class: 'tb-modal-body' }, [bodyNode]);
    const foot = el('div', { class: 'tb-modal-foot' });
    const overlay = el('div', { class: 'tb-modal-overlay' }, [
      el('div', { class: 'tb-modal' }, [head, body, foot])
    ]);
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    x.addEventListener('click', close);
    (buttons || []).forEach(function (b) {
      const cls = 'tb-btn' +
        (b.primary ? ' tb-btn-primary' : '') +
        (b.danger ? ' tb-btn-danger-solid' : '');
      const btn = el('button', { class: cls, type: 'button', text: b.label });
      btn.addEventListener('click', function () { b.onClick(close, btn); });
      foot.appendChild(btn);
    });
    layer.appendChild(overlay);
    return close;
  }

  /* ---------- タブ・セレクタ・レイアウト ---------- */

  function updateTabUI() {
    document.querySelectorAll('#tb-tabs .tb-tab').forEach(function (t) {
      t.classList.toggle('tb-active', t.getAttribute('data-office') === state.office);
    });
  }

  function confirmDiscard() {
    if (!state.dirty) return true;
    return window.confirm('未保存の変更があります。破棄して表示を切り替えますか？');
  }

  function onTabClick(office) {
    if (office === state.office) return;
    if (!confirmDiscard()) return;
    state.office = office;
    updateTabUI();
    loadBoard();
  }

  // タブ右側の内訳バッジを更新する。事業所内訳・幼児内訳・小学生以上内訳を別々のバッジとして表示する。
  //   訪問タブ    ：事業所別バッジ（玉城◯人・明和◯人／「内訳：」の文言なし）＋ 幼児バッジ＋小学生以上バッジ
  //   玉城／明和タブ：幼児バッジ＋小学生以上バッジ
  function updateSummaryBar() {
    _setBadge('tb-office-summary', (state.office === '訪問') ? visitBreakdownHtml() : '');
    _setBadge('tb-yoji-summary', gradeBreakdownYojiHtml());
    _setBadge('tb-sho-summary', gradeBreakdownShoPlusHtml());
  }

  function _setBadge(id, html) {
    const box = document.getElementById(id);
    if (!box) return;
    if (html) {
      box.innerHTML = html;
      box.style.display = '';
    } else {
      box.innerHTML = '';
      box.style.display = 'none';
    }
  }

  function onSelectorChange() {
    const ns = document.getElementById('tb-nendo');
    const ms = document.getElementById('tb-month');
    if (!ns || !ms) return;
    const newN = Number(ns.value);
    const newM = Number(ms.value);
    if (newN === state.nendo && newM === state.month) return;
    if (!confirmDiscard()) {
      ns.value = String(state.nendo);
      ms.value = String(state.month);
      return;
    }
    state.nendo = newN;
    state.month = newM;
    loadBoard();
  }

  function buildLayout(root) {
    root.innerHTML = '';
    const wrap = el('div', { class: 'tb-wrap' });
    wrap.innerHTML = [
      '<div class="tb-row1">',
      ' <span class="tb-label">年度</span><select id="tb-nendo" class="tb-select"></select>',
      ' <span class="tb-label">月</span><select id="tb-month" class="tb-select"></select>',
      ' <div class="tb-tabs" id="tb-tabs"></div>',
      ' <span class="tb-summary-badge" id="tb-office-summary" style="display:none"></span>',
      '</div>',
      '<div class="tb-row2">',
      ' <span class="tb-summary-badge" id="tb-yoji-summary" style="display:none"></span>',
      ' <span class="tb-summary-badge" id="tb-sho-summary" style="display:none"></span>',
      '</div>',
      '<div class="tb-toolbar">',
      ' <button type="button" id="tb-confirm" class="tb-btn">確定</button>',
      ' <button type="button" id="tb-save" class="tb-btn tb-btn-save">保存</button>',
      ' <button type="button" id="tb-undo" class="tb-btn">↺ 元に戻す</button>',
      ' <button type="button" id="tb-redo" class="tb-btn">↻ やり直す</button>',
      ' <button type="button" id="tb-staff" class="tb-btn">スタッフ管理</button>',
      ' <button type="button" id="tb-import" class="tb-btn">利用者リストから読込</button>',
      ' <button type="button" id="tb-importmonth" class="tb-btn">他月から読込</button>',
      ' <button type="button" id="tb-push" class="tb-btn tb-btn-danger-solid">利用者リストへ反映</button>',
      '</div>',
      '<div class="tb-board-outer">',
      ' <div class="tb-board" id="tb-board"></div>',
      ' <div id="tb-empty" style="display:none"></div>',
      '</div>',
      '<div class="tb-loading" id="tb-loading"><div class="tb-spinner"></div><div>処理中…</div></div>',
      '<div id="tb-modal-layer"></div>'
    ].join('');
    root.appendChild(wrap);

    if (!document.getElementById('tb-toast')) {
      document.body.appendChild(el('div', { id: 'tb-toast' }));
    }

    // 年度プルダウン（今年度の前後をカバー）
    const ns = document.getElementById('tb-nendo');
    if (ns) {
      const fyNow = fyOfToday();
      for (let fy = fyNow - 3; fy <= fyNow + 1; fy++) {
        const v = nendoValueFromFY(fy);
        ns.appendChild(el('option', { value: String(v), text: nendoLabel(v) }));
      }
      // 選択中の年度が範囲外なら選択肢として追加する
      let found = false;
      for (let i = 0; i < ns.options.length; i++) {
        if (ns.options[i].value === String(state.nendo)) { found = true; break; }
      }
      if (!found) ns.appendChild(el('option', { value: String(state.nendo), text: nendoLabel(state.nendo) }));
      ns.value = String(state.nendo);
      ns.addEventListener('change', onSelectorChange);
    }

    // 月プルダウン（年度順：4月→3月）
    const ms = document.getElementById('tb-month');
    if (ms) {
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].forEach(function (m) {
        ms.appendChild(el('option', { value: String(m), text: m + '月' }));
      });
      ms.value = String(state.month);
      ms.addEventListener('change', onSelectorChange);
    }

    // 事業所タブ（玉城／明和／訪問）。すべてレコード切替タブ＝それぞれ別々に保存する。
    const tabs = document.getElementById('tb-tabs');
    if (tabs) {
      CONFIG.OFFICES.forEach(function (o) {
        const t = el('button', {
          class: 'tb-tab', type: 'button', text: o.label, dataset: { office: o.value }
        });
        t.addEventListener('click', function () { onTabClick(o.value); });
        tabs.appendChild(t);
      });
      updateTabUI();
    }

    // ツールバーのボタン
    const bSave = document.getElementById('tb-save');
    if (bSave) bSave.addEventListener('click', doSave);
    const bConfirm = document.getElementById('tb-confirm');
    if (bConfirm) bConfirm.addEventListener('click', onConfirmToggle);
    const bUndo = document.getElementById('tb-undo');
    if (bUndo) bUndo.addEventListener('click', undo);
    const bRedo = document.getElementById('tb-redo');
    if (bRedo) bRedo.addEventListener('click', redo);
    const bStaff = document.getElementById('tb-staff');
    if (bStaff) bStaff.addEventListener('click', function () {
      if (state.recordId) openStaffModal();
    });
    const bPush = document.getElementById('tb-push');
    if (bPush) bPush.addEventListener('click', pushToChildApp);
    const bImport = document.getElementById('tb-import');
    if (bImport) bImport.addEventListener('click', importFromChildApp);
    const bImportMonth = document.getElementById('tb-importmonth');
    if (bImportMonth) bImportMonth.addEventListener('click', importFromOtherMonth);
  }

  /* ============================================================
   * ブロック4／4 : 保存・反映・読込・モーダル・初期化
   * ============================================================ */

  /* ---------- 保存 ---------- */

  // assignment_data と スタッフ欄を同時に更新（保存経路を一本化）
  async function saveRecord() {
    const F = CONFIG.F231;
    const rec = {};
    rec[F.data] = { value: JSON.stringify(buildAssignmentJson(), null, 1) };
    rec[F.staff] = { value: orderedStaffCodes().map(function (c) { return { code: c }; }) };
    await apiCall('/k/v1/record.json', 'PUT', { app: state.appId, id: state.recordId, record: rec });
    markDirty(false);
  }

  async function doSave() {
    if (!state.recordId) return;
    showLoading(true);
    try {
      await saveRecord();
      toast('保存しました');
    } catch (e) {
      showBanner('error', '保存に失敗しました', [errMsg(e)]);
    } finally {
      showLoading(false);
    }
  }

  /* ---------- 利用者リストへ反映（担当表 → 利用者リスト） ---------- */

  async function pushToChildApp() {
    if (!state.recordId) return;

    // 何件が書き換わるかを事前に集計してプレビュー表示する。
    // 【重要】この時点では保存も書き込みも一切行わない（読み込みのみ）。
    showLoading(true);
    const updates = [];
    const skipped = [];
    const clearing = [];
    try {
      await loadChildren();   // 利用者リストの最新の担当を取得（読み込みのみ）
      const targetCode = CONFIG.F10[currentOfficeConf().targetField];
      state.children.forEach(function (c) {
        if (c.tantouCodes.length >= 2) {
          skipped.push(c.name + '：利用者リスト側の担当が2人以上のためスキップします');
          return;
        }
        const target = effectiveStaffOf(c.id);
        const cur = c.tantouCodes[0] || null;
        if (target === cur) return;
        const r = {};
        r[targetCode] = { value: target ? [{ code: target }] : [] };
        updates.push({ id: c.id, record: r });
        if (!target && cur) clearing.push(c.name);
      });
    } catch (e) {
      showLoading(false);
      showBanner('error', '反映前の集計でエラーが発生しました', [errMsg(e)]);
      return;
    } finally {
      showLoading(false);
    }

    if (!updates.length) {
      showBanner('info', '反映の必要はありませんでした', [
        '担当表と利用者リストの担当は既に一致しています。' +
        (skipped.length ? '（担当2人以上のためスキップ対象が ' + skipped.length + '件あります）' : '')
      ]);
      renderBoard();
      return;
    }

    // 危険な操作のため、内容をプレビューしたうえで明示的に実行ボタンを押させる。
    // 【重要】ここで「キャンセル」を押した場合、何も保存・書き込みされない。
    const targetLabel = CONFIG.F10[currentOfficeConf().targetField];
    const body = el('div');
    body.appendChild(el('div', {
      class: 'tb-banner tb-banner-error',
      html: '<b>これは利用者リスト（顧客台帳）の「' + esc(targetLabel) +
            '」を直接書き換える危険な操作です。</b><br>実行すると元に戻せません。内容をよく確認してください。'
    }));
    body.appendChild(el('p', {
      html: '対象：<b>' + esc(nendoLabel(state.nendo) + ' ' +
            state.month + '月・' + currentOfficeConf().label) + '</b><br>' +
            '書き換える件数：<b>' + updates.length + '件</b>' +
            (clearing.length ? '<br>うち担当を<b>空欄にする</b>：<b>' + clearing.length + '人</b>' : '') +
            (skipped.length ? '<br>担当2人以上でスキップ：' + skipped.length + '件' : '')
    }));
    if (clearing.length) {
      const box = el('div', { class: 'tb-banner tb-banner-warn' });
      box.appendChild(el('div', { class: 'tb-banner-title', text: '担当が空欄になる利用者（' + clearing.length + '人）' }));
      const ul = el('ul');
      clearing.forEach(function (n) { ul.appendChild(el('li', { text: n })); });
      box.appendChild(ul);
      body.appendChild(box);
    }
    body.appendChild(el('div', {
      class: 'tb-modal-note',
      text: '本当に実行する場合のみ、右下の赤いボタンを押してください。キャンセルすれば何も変更されません。'
    }));

    openModal('利用者リストへ反映（危険な操作）', body, [
      { label: 'キャンセル', onClick: function (close) { close(); } },
      {
        label: 'はい、' + updates.length + '件を反映します', danger: true,
        onClick: function (close, btn) {
          btn.disabled = true;
          doPushToChildApp(updates, skipped)
            .then(function () { close(); })
            .catch(function (e) {
              btn.disabled = false;
              showBanner('error', '利用者リストへの反映でエラーが発生しました', [errMsg(e)]);
            });
        }
      }
    ]);
  }

  // 【重要】この関数は「はい、反映します」を押した後にのみ呼ばれる。
  // 担当表の保存も、利用者リストへの書き込みも、すべてここで初めて実行される。
  async function doPushToChildApp(updates, skipped) {
    showLoading(true);
    try {
      await saveRecord();   // 確認後に初めて担当表を保存（整合性の保証）
      for (let i = 0; i < updates.length; i += 100) {
        await apiCall('/k/v1/records.json', 'PUT', {
          app: CONFIG.APP_CHILD, records: updates.slice(i, i + 100)
        });
      }
      await loadChildren();
      renderBoard();
      toast('利用者リストへ反映しました（更新 ' + updates.length + '件／スキップ ' + skipped.length + '件）');
      if (skipped.length) showBanner('warn', '反映をスキップした利用者', skipped);
    } finally {
      showLoading(false);
    }
  }

  /* ---------- 利用者リストから読込（利用者リスト → 担当表） ---------- */

  async function importFromChildApp() {
    if (!state.recordId) return;
    const targetLabel = CONFIG.F10[currentOfficeConf().targetField];
    const ok = window.confirm(
      '【利用者リストから読込】\n' +
      '利用者リストの現在の「' + targetLabel + '」を読み込み、この担当表に書き出して保存します。\n' +
      '画面上の未保存の編集内容は上書きされます。\n' +
      '（担当が2人以上の利用者はスキップし、いまの配置を維持します）\n' +
      'よろしいですか？'
    );
    if (!ok) return;
    showLoading(true);
    try {
      await loadChildren();
      const skipped = [];
      const added = [];
      const next = new Map();
      state.children.forEach(function (c) {
        if (c.tantouCodes.length >= 2) {
          skipped.push(c.name + '：担当が2人以上のため読込をスキップしました（配置を維持）');
          next.set(c.id, effectiveStaffOf(c.id));
          return;
        }
        const code = c.tantouCodes[0] || null;
        if (code) {
          if (c.tantouNames[0]) state.staffNameFallback.set(code, c.tantouNames[0]);
          if (state.staffCodes.indexOf(code) === -1) {
            state.staffCodes.push(code);
            added.push(staffInfo(code).name);
          }
        }
        next.set(c.id, code);
      });
      state.assignments = next;
      resetHistory();
      await saveRecord();
      renderBoard();
      toast('利用者リストから読み込み、保存しました');
      if (added.length) showBanner('info', 'スタッフ列に自動追加しました', uniq(added));
      if (skipped.length) showBanner('warn', '読込をスキップした利用者', skipped);
    } catch (e) {
      showBanner('error', '利用者リストからの読込でエラーが発生しました', [errMsg(e)]);
    } finally {
      showLoading(false);
    }
  }

  /* ---------- 他月から読込（別の年度・月をこの月にコピー） ---------- */

  async function importFromOtherMonth() {
    if (!state.recordId) return;

    showLoading(true);
    let candidates = [];
    try {
      const F = CONFIG.F231;
      const recs = await fetchAllRecords(state.appId,
        F.office + ' in ("' + state.office + '")', [F.nendo, F.month]);
      candidates = recs.map(function (r) {
        return { id: String(r.$id.value), nendo: Number(r[F.nendo].value), month: Number(r[F.month].value) };
      }).filter(function (r) {
        return !(r.nendo === state.nendo && r.month === state.month);
      });
      candidates.sort(function (a, b) { return sortKeyOf(b) - sortKeyOf(a); });
    } catch (e) {
      showLoading(false);
      showBanner('error', '他月レコードの取得に失敗しました', [errMsg(e)]);
      return;
    } finally {
      showLoading(false);
    }

    if (!candidates.length) {
      showBanner('info', '読み込める他月の担当表がありません', [
        '同じ事業所（' + currentOfficeConf().label +
        '）の、別の年度・月の担当表がまだ作成されていません。'
      ]);
      return;
    }

    const body = el('div');
    body.appendChild(el('div', {
      class: 'tb-banner tb-banner-warn',
      html: '選んだ月の担当表の内容（担当・備考・全体メモ・スタッフ列）を、<b>この月にコピーします。</b>' +
            '<br>現在表示中の未保存の編集内容は<b>上書き</b>されます。'
    }));
    body.appendChild(el('p', {
      html: 'コピー先：<b>' + esc(nendoLabel(state.nendo) + ' ' +
            state.month + '月・' + currentOfficeConf().label) + '</b>'
    }));
    body.appendChild(el('div', { style: 'font-weight:700;margin:8px 0 4px;', text: 'コピー元の年月を選択' }));

    const sel = el('select', { class: 'tb-select' });
    candidates.forEach(function (c) {
      sel.appendChild(el('option', { value: c.id, text: nendoLabel(c.nendo) + ' ' + c.month + '月' }));
    });
    const prevBtn = el('button', { class: 'tb-btn', type: 'button', text: '前月を選択' });
    prevBtn.addEventListener('click', function () {
      const p = prevMonthOf(state.nendo, state.month);
      let hit = null;
      candidates.forEach(function (c) { if (!hit && c.nendo === p.nendo && c.month === p.month) hit = c; });
      if (hit) {
        sel.value = hit.id;
      } else {
        window.alert('前月（' + nendoLabel(p.nendo) + ' ' + p.month + '月）の担当表が見つかりません。');
      }
    });
    body.appendChild(el('div', { class: 'tb-inline-controls' }, [sel, prevBtn]));

    openModal('他月から読込', body, [
      { label: 'キャンセル', onClick: function (close) { close(); } },
      {
        label: 'この月をコピー', primary: true,
        onClick: function (close, btn) {
          btn.disabled = true;
          doImportFromOtherMonth(sel.value)
            .then(function () { close(); })
            .catch(function (e) {
              btn.disabled = false;
              window.alert('コピーに失敗しました：' + errMsg(e));
            });
        }
      }
    ]);
  }

  async function doImportFromOtherMonth(srcId) {
    showLoading(true);
    try {
      const F = CONFIG.F231;
      const resp = await apiCall('/k/v1/record.json', 'GET', { app: state.appId, id: srcId });
      const src = resp.record;

      // コピー元のスタッフ列を取り込む
      const srcStaff = (src[F.staff] && src[F.staff].value) || [];
      state.staffCodes = srcStaff.map(function (u) {
        if (u.name) state.staffNameFallback.set(u.code, u.name);
        return u.code;
      });

      // コピー元の配置データを、現在表示中の児童に対応付ける
      const json = parseAssignmentData((src[F.data] && src[F.data].value) || '');
      state.boardNote = json.boardNote || '';
      state.confirmed = false;   // 確定状態はコピー元から引き継がない（必ず未確定から開始する）
      const byChild = {};
      (json.assignments || []).forEach(function (a) {
        if (a && a.childId != null) byChild[String(a.childId)] = a;
      });
      state.assignments = new Map();
      state.notes = new Map();
      state.children.forEach(function (c) {
        const a = byChild[c.id];
        const code = (a && a.staffCode) ? String(a.staffCode) : null;
        state.assignments.set(c.id, code);
        state.notes.set(c.id, (a && a.note) || '');
        if (code && state.staffCodes.indexOf(code) === -1) {
          state.staffCodes.push(code);
        }
      });

      resetHistory();
      markDirty(true);   // コピー結果は未保存状態。内容を確認して「保存」を押してもらう
      renderBoard();
      toast('他月の内容をコピーしました。内容を確認して「保存」を押してください');
    } finally {
      showLoading(false);
    }
  }

  /* ---------- スタッフ管理モーダル ---------- */

  function openStaffModal() {
    const container = el('div');

    function rebuild() {
      container.innerHTML = '';
      container.appendChild(el('div', {
        class: 'tb-banner tb-banner-info',
        html: 'スタッフ（担当職員の列）の追加・削除を行います。<b>変更は「保存」ボタンで確定します。</b>'
      }));

      const codes = orderedStaffCodes();
      if (!codes.length) {
        container.appendChild(el('p', { text: '現在、スタッフは選択されていません。下の「追加」から選んでください。' }));
      }
      codes.forEach(function (code) {
        const info = staffInfo(code);
        const row = el('div', { class: 'tb-staff-row' });
        row.appendChild(el('span', { class: 'tb-staff-name', text: info.name }));
        if (info.retired) row.appendChild(el('span', { class: 'tb-tag-retired', text: '退職' }));
        if (info.unknown) row.appendChild(el('span', { class: 'tb-tag-unknown', text: 'マスタ未登録' }));
        const del = el('button', { class: 'tb-btn tb-btn-danger', type: 'button', text: '削除' });
        del.addEventListener('click', function () {
          const assigned = state.children.filter(function (c) { return effectiveStaffOf(c.id) === code; });
          const msg = assigned.length
            ? info.name + ' を列から削除します。\n担当中の利用者 ' + assigned.length + '人 は「未設置」に移動します。よろしいですか？'
            : info.name + ' を列から削除します。よろしいですか？';
          if (!window.confirm(msg)) return;
          assigned.forEach(function (c) { state.assignments.set(c.id, null); });
          state.staffCodes = state.staffCodes.filter(function (x) { return x !== code; });
          if (assigned.length) pushHistory();
          markDirty(true);
          renderBoard();
          rebuild();
        });
        row.appendChild(del);
        container.appendChild(row);
      });

      // 追加セクション（職員マスタの在職者のみ・社員ID昇順）
      container.appendChild(el('div', { style: 'margin-top:14px;font-weight:700;', text: 'スタッフを追加' }));
      const cand = [];
      state.staffMaster.forEach(function (info) {
        if (!info.retired && state.staffCodes.indexOf(info.code) === -1) cand.push(info);
      });
      cand.sort(function (a, b) {
        const ea = a.empId == null ? Number.MAX_SAFE_INTEGER : a.empId;
        const eb = b.empId == null ? Number.MAX_SAFE_INTEGER : b.empId;
        if (ea !== eb) return ea - eb;
        return a.name.localeCompare(b.name, 'ja');
      });

      const addWrap = el('div', { class: 'tb-inline-controls' });
      if (cand.length) {
        const sel = el('select', { class: 'tb-select' });
        cand.forEach(function (info) {
          sel.appendChild(el('option', { value: info.code, text: info.name }));
        });
        const add = el('button', { class: 'tb-btn tb-btn-primary', type: 'button', text: '追加' });
        add.addEventListener('click', function () {
          state.staffCodes.push(sel.value);
          markDirty(true);
          renderBoard();
          rebuild();
        });
        addWrap.appendChild(sel);
        addWrap.appendChild(add);
      } else {
        addWrap.appendChild(el('span', { text: '追加できる在職スタッフがいません（職員マスタをご確認ください）。' }));
      }
      container.appendChild(addWrap);
      container.appendChild(el('div', {
        class: 'tb-modal-note',
        text: '※UNDO／REDOの対象はカードの移動のみです。スタッフの増減は対象外です。'
      }));
    }

    rebuild();
    openModal('スタッフ管理', container, [
      { label: '閉じる', primary: true, onClick: function (close) { close(); } }
    ]);
  }

  /* ---------- 新規作成モーダル（3方式） ---------- */

  async function openNewRecordModal() {
    showLoading(true);
    let candidates = [];
    try {
      const F = CONFIG.F231;
      const recs = await fetchAllRecords(state.appId,
        F.office + ' in ("' + state.office + '")', [F.nendo, F.month]);
      candidates = recs.map(function (r) {
        return { id: String(r.$id.value), nendo: Number(r[F.nendo].value), month: Number(r[F.month].value) };
      }).filter(function (r) {
        return !(r.nendo === state.nendo && r.month === state.month);
      });
      candidates.sort(function (a, b) { return sortKeyOf(b) - sortKeyOf(a); });
    } catch (e) {
      showBanner('error', '過去レコードの取得に失敗しました', [errMsg(e)]);
    } finally {
      showLoading(false);
    }

    const body = el('div');
    body.appendChild(el('p', {
      html: '<b>' + esc(nendoLabel(state.nendo) + ' ' +
            state.month + '月・' + currentOfficeConf().label) +
            '</b> の担当表を作成します。作成方法を選んでください。'
    }));

    let mode = candidates.length ? 'copy' : 'import';
    const blocks = {};

    function selectMode(k) {
      mode = k;
      Object.keys(blocks).forEach(function (key) {
        blocks[key].radio.checked = (key === k);
        blocks[key].block.classList.toggle('tb-selected', key === k);
      });
    }

    function makeBlock(key, title, desc, controls) {
      const radio = el('input', { type: 'radio', name: 'tb-newmode' });
      const b = el('div', { class: 'tb-radio-block' }, [
        el('div', { class: 'tb-radio-title' }, [radio, title]),
        el('div', { class: 'tb-radio-desc', text: desc })
      ]);
      if (controls) b.appendChild(controls);
      b.addEventListener('click', function () {
        if (radio.disabled) return;
        selectMode(key);
      });
      blocks[key] = { block: b, radio: radio };
      return b;
    }

    const copySel = el('select', { class: 'tb-select' });
    candidates.forEach(function (c) {
      copySel.appendChild(el('option', { value: c.id, text: nendoLabel(c.nendo) + ' ' + c.month + '月' }));
    });
    const prevBtn = el('button', { class: 'tb-btn', type: 'button', text: '前月を選択' });
    prevBtn.addEventListener('click', function () {
      const p = prevMonthOf(state.nendo, state.month);
      let hit = null;
      candidates.forEach(function (c) { if (!hit && c.nendo === p.nendo && c.month === p.month) hit = c; });
      if (hit) {
        copySel.value = hit.id;
      } else {
        window.alert('前月（' + nendoLabel(p.nendo) + ' ' + p.month + '月）のレコードが見つかりません。');
      }
    });
    const copyControls = el('div', { class: 'tb-inline-controls' }, [copySel, prevBtn]);

    const targetLabel = CONFIG.F10[currentOfficeConf().targetField];
    const bCopy = makeBlock('copy', '(a) 過去月をコピーして作成',
      '選んだ月の担当・備考・全体メモ・スタッフ列をそのまま引き継ぎます。', copyControls);
    if (!candidates.length) {
      bCopy.classList.add('tb-disabled');
      blocks.copy.radio.disabled = true;
      copySel.disabled = true;
      prevBtn.disabled = true;
    }
    body.appendChild(bCopy);
    body.appendChild(makeBlock('import', '(b) 利用者リストの現在の担当を読み込んで作成',
      '利用者リストの「' + targetLabel + '」の現状から担当表を作ります（担当2人以上の利用者は未設置にします）。', null));
    body.appendChild(makeBlock('empty', '(c) 空の状態から作成',
      '全利用者を「未設置」に置いた状態で作成します。スタッフ列は後から「スタッフ管理」で追加します。', null));
    selectMode(mode);

    openModal('担当表の新規作成', body, [
      { label: 'キャンセル', onClick: function (close) { close(); } },
      {
        label: 'この内容で作成', primary: true,
        onClick: function (close, btn) {
          btn.disabled = true;
          createNewRecord(mode, copySel.value)
            .then(function () { close(); })
            .catch(function (e) {
              btn.disabled = false;
              window.alert('作成に失敗しました：' + errMsg(e));
            });
        }
      }
    ]);
  }

  async function createNewRecord(mode, srcId) {
    showLoading(true);
    try {
      const F = CONFIG.F231;

      // 二重作成防止：直前にもう一度検索する
      const exist = await searchBoardRecord();
      if (exist) {
        window.alert('同じ 年度・月・事業所 のレコードが既に存在するため、そのレコードを表示します。');
        await loadBoard();
        return;
      }

      let dataStr = '';
      let staffVal = [];
      const importErrors = [];

      if (mode === 'copy') {
        if (!srcId) throw new Error('コピー元が選択されていません');
        const resp = await apiCall('/k/v1/record.json', 'GET', { app: state.appId, id: srcId });
        const srcDataStr = (resp.record[F.data] && resp.record[F.data].value) || '';
        // 確定状態はコピー元から引き継がない（新規作成したボードは必ず未確定から開始する）
        const srcJson = parseAssignmentData(srcDataStr);
        srcJson.confirmed = false;
        srcJson.nendo = state.nendo;
        srcJson.month = state.month;
        srcJson.office = state.office;
        dataStr = JSON.stringify(srcJson, null, 1);
        staffVal = ((resp.record[F.staff] && resp.record[F.staff].value) || []).map(function (u) {
          if (u.name) state.staffNameFallback.set(u.code, u.name);
          return { code: u.code };
        });
      } else if (mode === 'import') {
        await loadChildren();
        const seen = {};
        const assigns = [];
        state.children.forEach(function (c) {
          if (c.tantouCodes.length >= 2) {
            importErrors.push(c.name + '：担当が2人以上のため未設置にしました');
            assigns.push({ childId: c.id, childName: c.name, staffCode: null, note: '' });
            return;
          }
          const code = c.tantouCodes[0] || null;
          if (code) {
            seen[code] = true;
            if (c.tantouNames[0]) state.staffNameFallback.set(code, c.tantouNames[0]);
          }
          assigns.push({ childId: c.id, childName: c.name, staffCode: code, note: '' });
        });
        staffVal = sortStaffCodes(Object.keys(seen)).map(function (code) { return { code: code }; });
        dataStr = JSON.stringify({
          version: 2, savedAt: new Date().toISOString(),
          nendo: state.nendo, month: state.month, office: state.office,
          boardNote: '', confirmed: false, assignments: assigns
        }, null, 1);
      } else {
        dataStr = JSON.stringify({
          version: 2, savedAt: new Date().toISOString(),
          nendo: state.nendo, month: state.month, office: state.office,
          boardNote: '', confirmed: false, assignments: []
        }, null, 1);
      }

      const rec = {};
      rec[F.nendo] = { value: String(state.nendo) };
      rec[F.month] = { value: String(state.month) };
      rec[F.office] = { value: state.office };
      rec[F.staff] = { value: staffVal };
      rec[F.data] = { value: dataStr };
      await apiCall('/k/v1/record.json', 'POST', { app: state.appId, record: rec });

      await loadBoard();
      toast('担当表を新規作成しました');
      if (importErrors.length) showBanner('warn', '読込をスキップした利用者（未設置にしました）', importErrors);
    } finally {
      showLoading(false);
    }
  }

  /* ---------- ボード読み込み・初期化 ---------- */

  async function loadBoard() {
    showLoading(true);
    clearBanners();
    try {
      // 表示に必須の「対象児童」を読み込む
      await loadChildren();
      updateSummaryBar();   // タブ右側の内訳表示を更新（訪問=事業所別／玉城・明和=学年別）
      // 別ボードの担当数は付加情報。失敗してもボード表示は止めない。
      try {
        await loadCrossOfficeCounts();
      } catch (ce) {
        state.crossCounts = new Map();
      }
      const rec = await searchBoardRecord();
      applyLoadedRecord(rec);
      renderBoard();
    } catch (e) {
      showBanner('error', '読み込みに失敗しました', [errMsg(e)]);
      applyLoadedRecord(null);
      renderBoard();
    } finally {
      // ここで必ずローディング表示を解除する（この後の処理でUIを固めない）
      showLoading(false);
    }

    // ドラッグ＆ドロップ用ライブラリは、画面表示をブロックせずに裏で読み込む。
    // 読み込めたらボードを再描画してカード移動を有効にする。
    if (!window.Sortable) {
      ensureSortable().then(function () {
        if (state.recordId) renderBoard();
      }).catch(function () {
        showBanner('warn', 'ドラッグ＆ドロップ用の部品を読み込めませんでした', [
          'カードの移動だけができない状態です（表示・保存・各ボタンは使えます）。',
          '通信環境をご確認のうえ、月を切り替えるか、画面を再読み込みしてください。'
        ]);
      });
    }
  }

  function registerBeforeUnload() {
    if (beforeUnloadRegistered) return;
    beforeUnloadRegistered = true;
    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function init(root) {
    injectCss();
    state.appId = getAppId();

    if (state.nendo == null) {
      const fy = fyOfToday();
      state.nendo = nendoValueFromFY(fy);
      state.month = (new Date()).getMonth() + 1;
      state.office = CONFIG.OFFICES[0].value;
    }

    buildLayout(root);
    registerBeforeUnload();

    const initBanners = [];
    showLoading(true);
    try {
      try {
        await loadStaffMaster();
      } catch (e) {
        initBanners.push({
          kind: 'warn',
          title: '職員マスタの読み込みに失敗しました',
          lines: [errMsg(e), '職員名や希望担当人数の表示が一部制限されます。']
        });
      }
    } finally {
      showLoading(false);
    }

    await loadBoard();
    initBanners.forEach(function (b) { showBanner(b.kind, b.title, b.lines); });
  }

  /* ---------- イベント登録 ---------- */

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    const root = document.getElementById(CONFIG.ROOT_ID);
    // 既に構築済みのDOMが残っている場合は再初期化しない（編集状態の保持）
    if (root && !root.querySelector('.tb-wrap')) {
      init(root);
    }
    return event;
  });

})();
