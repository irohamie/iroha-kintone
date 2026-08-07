/*
 * =====================================================================
 *  アプリ207「支援計画」カスタマイズビュー: 更新月一覧
 *  app207_renewal_list.js
 * ---------------------------------------------------------------------
 *  version : 1.0.0 (2026-07-16)
 *  対象    : kintone アプリ207（1レコード＝児童1名×1プラン年）
 *  設計図  : アプリ207_更新月一覧_設計図.md（確定版）に準拠
 *  参照実装: アプリ42「支援計画一覧」カスタマイズの設計思想を踏襲
 *
 *  ■ セットアップ
 *   1. アプリ207にカスタマイズビュー「更新月一覧」を作成し、
 *      HTML欄に <div id="a207u-root"></div> のみ記載（ページネーション不要）
 *   2. 本ファイルを「PC用JavaScriptファイル」としてアップロード
 *   3. 実行ユーザーにはアプリ207とアプリ10（児童氏名マスタ）の閲覧権限が必要
 *
 *  ■ 共存への配慮（207は複数カスタマイズが稼働するアプリ）
 *   - 即時実行関数でグローバル汚染なし / イベントは必ず return event
 *   - CSS・DOM・sessionStorage はすべて a207u- / app207RenewalState 名前空間
 *   - root.dataset による二重バインド防止
 *
 *  ■ 設計図からの補完点（コード生成時の裁量。§13「据え置き」分を含む）
 *   1. 利用先スイッチ「両方」選択時は通常モードでも「利用先」列を表示
 *      （設計図§8.6は検索モードのみ言及。混在表示の識別性のため通常時も追加）
 *   2. 前期「— 対象外」判定に安全ガード:
 *      前期計画開始が空でも前期側の添付が1件でも存在する場合は対象外にせず
 *      通常判定にする（実在データが「対象外」表示で隠れる事故を防止）
 *   3. 担当プルダウンで選択中の担当が現在ウィンドウに存在しない場合は
 *      「（範囲外）」ラベル付きで選択肢に固定表示し、選択を維持
 *   4. 利用状況が空欄の行は状態バッジを表示しない（行自体は表示）
 *
 *  ■ Node.js テスト
 *   `node -e "const m=require('./app207_renewal_list.js'); ..."` で
 *   末尾の module.exports から純関数を単体テスト可能。
 * =====================================================================
 */
(function () {
  'use strict';

  /* =====================================================================
   * Block 1/4  CONFIG・定数・ユーティリティ・CSS
   * ===================================================================== */

  var CONFIG = {
    VIEW_NAME: '更新月一覧',
    ROOT_ID: 'a207u-root',
    STORAGE_KEY: 'app207RenewalState',
    FIELDS: {
      NAME: '氏名',
      FURIGANA: 'フリガナ',
      BIRTHDAY: '生年月日',
      RIYOUSAKI: '利用先',
      TANTO: '担当',
      STATUS: '利用状況',
      ZK_START: '前期計画開始',
      KK_START: '後期計画開始',
      ATT_ZK_AN: '前期案',
      ATT_ZK_SIGN: '前期サイン済',
      ATT_ZH_AN: '前期評価案',
      ATT_ZH_SIGN: '前期評価サイン済',
      ATT_KK_AN: '後期案',
      ATT_KK_SIGN: '後期サイン済',
      ATT_KH_AN: '後期評価案',
      ATT_KH_SIGN: '後期評価サイン済'
    },
    // 起動時検証で期待するフィールドタイプ
    FIELD_TYPES: {
      NAME: 'SINGLE_LINE_TEXT',      // ルックアップの実体型
      FURIGANA: 'SINGLE_LINE_TEXT',
      BIRTHDAY: 'DATE',
      RIYOUSAKI: 'SINGLE_LINE_TEXT',
      TANTO: 'SINGLE_LINE_TEXT',
      STATUS: 'SINGLE_LINE_TEXT',
      ZK_START: 'DATE',
      KK_START: 'DATE',
      ATT_ZK_AN: 'FILE',
      ATT_ZK_SIGN: 'FILE',
      ATT_ZH_AN: 'FILE',
      ATT_ZH_SIGN: 'FILE',
      ATT_KK_AN: 'FILE',
      ATT_KK_SIGN: 'FILE',
      ATT_KH_AN: 'FILE',
      ATT_KH_SIGN: 'FILE'
    },
    CROSS: {
      CHILD: {
        APP_ID: 10,
        NAME: '児童氏名',
        BIRTH: '誕生日',
        CONTRACT: '契約日',
        STATUS: '利用状況',
        NAME_TYPE: 'SINGLE_LINE_TEXT',
        BIRTH_TYPE: 'DATE',
        CONTRACT_TYPE: 'DATE',
        STATUS_TYPE: 'RADIO_BUTTON'
      }
    }
  };

  // 添付フィールドのキー一覧（合算・判定で使用）
  var ATT_KEYS = [
    'ATT_ZK_AN', 'ATT_ZK_SIGN', 'ATT_ZH_AN', 'ATT_ZH_SIGN',
    'ATT_KK_AN', 'ATT_KK_SIGN', 'ATT_KH_AN', 'ATT_KH_SIGN'
  ];
  var ZENKI_KEYS = ['ATT_ZK_AN', 'ATT_ZK_SIGN', 'ATT_ZH_AN', 'ATT_ZH_SIGN'];

  var RIYOUSAKI_TABS = ['玉城', '明和'];      // 完全一致
  var RIYOUSAKI_BOTH = '両方';                // スイッチ第3値（フィールド値とは比較しない）
  var RIYOUSAKI_HIDDEN = ['訪問のみ'];        // 既知だが対象外。警告なしで静かに除外（確定仕様）
  var STATUS_ACTIVE = '利用中';
  var STATUS_KNOWN = ['利用中', '検討中', '待機中', '終結'];

  var WINDOW_BEFORE = 0;                      // 単月表示（今月のみ）
  var WINDOW_AFTER = 0;
  var WINDOW_LEN = 1;
  var STEP_SMALL = 1;                         // ‹ › : ±1ヶ月
  var STEP_LARGE = 6;                         // « » : ±6ヶ月（大きく移動）

  var TANTO_ALL = '__ALL__';
  var TANTO_NONE = '__NONE__';

  // 学年マスタ（index順に表示。学年不明は最下部）
  var GRADE_MASTER = [
    '０歳児', '１歳児', '２歳児',
    '３歳児（年少）', '４歳児（年中）', '５歳児（年長）',
    '小学１年', '小学２年', '小学３年', '小学４年', '小学５年', '小学６年',
    '中学１年', '中学２年', '中学３年',
    '高校１年', '高校２年', '高校３年',
    '１８歳以上',
    '学年不明'
  ];
  var GRADE_UNKNOWN = GRADE_MASTER.length - 1;
  var GRADE_SECONDARY_START = GRADE_MASTER.indexOf('中学１年'); // 12（中学生以上表示切替の境界）

  var WARN_TYPE_LABELS = {
    unclassified: '分類不能（一覧から除外）',
    period_mismatch: '前期/後期の期間ズレ',
    py_inconsistent: '前期・後期のプラン年不一致',
    date_invalid: '開始日の値が不正',
    app10_missing: '児童マスタ未一致',
    app10_ambiguous: '児童マスタ重複一致',
    riyousaki_empty: '利用先が空欄（非表示）',
    riyousaki_unknown: '利用先が不明な値（非表示）'
  };
  var WARN_TYPE_ORDER = [
    'unclassified', 'period_mismatch', 'py_inconsistent', 'date_invalid',
    'app10_ambiguous', 'app10_missing',
    'riyousaki_empty', 'riyousaki_unknown'
  ];

  /* ------------------------------------------------------------------
   * 汎用ユーティリティ
   * ------------------------------------------------------------------ */

  function getStr(record, code) {
    if (!record || !record[code] || record[code].value == null) return '';
    return String(record[code].value).trim();
  }

  function fileCount(record, code) {
    if (!record || !record[code] || !record[code].value) return 0;
    var v = record[code].value;
    return Array.isArray(v) ? v.length : 0;
  }

  // 'YYYY-MM-DD' を厳密にパース。失敗時 null
  function parseDate(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  // ---- 月インデックス演算（設計図§4.1・§4.2） ----
  function monthIdx(y, m) { return y * 12 + (m - 1); }
  function idxToYM(idx) { return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 + 1 }; }
  // 誕生月Bから何ヶ月目か（0〜11）
  function offsetInPlanYear(dIdx, bIdx) { return (((dIdx - bIdx) % 12) + 12) % 12; }
  // プラン年 = その周期の開始誕生月が属する西暦年
  function planYearOf(dIdx, bIdx) {
    var off = offsetInPlanYear(dIdx, bIdx);
    return Math.floor((dIdx - off) / 12);
  }
  // offset 0〜5 = 前期('zenki') / 6〜11 = 後期('kouki')
  function periodOf(dIdx, bIdx) {
    return offsetInPlanYear(dIdx, bIdx) <= 5 ? 'zenki' : 'kouki';
  }
  // 4月始まり年度
  function fiscalYearOfIdx(idx) {
    var ym = idxToYM(idx);
    return ym.m >= 4 ? ym.y : ym.y - 1;
  }

  // アプリ10「契約日」から新規利用を検出（契約日が表示中の学年基準年度と同一年度なら「新」）
  function isNewEnrollment(contractRaw, fy) {
    if (!contractRaw) return false;
    var d = parseDate(contractRaw);
    if (!d) return false;
    return fiscalYearOfIdx(monthIdx(d.y, d.m)) === fy;
  }

  // 学年計算: 4/1生まれまでを前年コホート扱い（4/2区切り）
  // 学校教育法第17条: 就学は「満6歳に達した日の翌日以後における最初の学年の初め」から。
  // 例: 2021-11-08生まれ（コホート2021・4/2〜翌4/1区分）は、
  //     2026年度=4歳児(年中)・2027年度=5歳児(年長)・2028年度=小学1年（就学）。
  // これは cohort を基準にした「年度 - cohort - 1」で一致する（cohortのみだと1年早くなる）。
  function computeGrade(b, fiscalYear) {
    if (!b) return GRADE_UNKNOWN;
    var cohort = (b.m > 4 || (b.m === 4 && b.d >= 2)) ? b.y : b.y - 1;
    var n = fiscalYear - cohort - 1;
    if (n < 0) return GRADE_UNKNOWN;
    if (n >= 18) return 18; // １８歳以上
    return n;               // 0..17 が GRADE_MASTER の index と一致
  }

  // かな正規化: NFKC → カタカナ→ひらがな → 空白除去 → 小文字化
  function normalizeKana(s) {
    if (!s) return '';
    var t = String(s);
    if (t.normalize) t = t.normalize('NFKC');
    t = t.replace(/[\u30a1-\u30f6]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
    return t.replace(/[\s\u3000]/g, '').toLowerCase();
  }

  // 氏名=漢字部分一致 / フリガナ=かな正規化部分一致
  function matchesSearch(name, furigana, rawQuery) {
    var q = String(rawQuery == null ? '' : rawQuery).replace(/[\s\u3000]/g, '');
    if (!q) return true;
    var n = String(name == null ? '' : name).replace(/[\s\u3000]/g, '');
    if (n.indexOf(q) >= 0) return true;
    var nk = normalizeKana(q);
    if (!nk) return false;
    return normalizeKana(furigana).indexOf(nk) >= 0;
  }

  function jaCompare(a, b) {
    return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'ja');
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }

  // DOM生成ヘルパー
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') n.style.cssText = v;
        else n.setAttribute(k, v);
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (c == null) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function clearEl(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // レコード詳細URL（同一ドメイン相対）
  function recordUrl(appId, recId) {
    return '/k/' + appId + '/show#record=' + recId;
  }

  function pyLabel(py, birthM) {
    return py + '年' + birthM + '月〜';
  }

  /* ------------------------------------------------------------------
   * CSS（<style>注入・a207u-名前空間）
   * ------------------------------------------------------------------ */
  var CSS_TEXT = '' +
    '#a207u-root{font-size:13px;color:#212529;line-height:1.45;' +
      '-webkit-text-size-adjust:100%;padding:8px 4px 24px;}' +
    '#a207u-root *{box-sizing:border-box;}' +
    '.a207u-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0;' +
      'padding:6px 8px;border-radius:8px;}' +
    '.a207u-navbar{background:#e7f0fd;border:1px solid #bcd4f7;}' +
    '.a207u-toolbar{background:#fff7e0;border:1px solid #ffe2a8;}' +
    '.a207u-btn{min-width:40px;min-height:36px;padding:6px 10px;border:1px solid #ced4da;' +
      'border-radius:6px;background:#fff;cursor:pointer;font-size:13px;color:#343a40;}' +
    '.a207u-btn:active{background:#e9ecef;}' +
    '.a207u-btn:disabled{opacity:.4;cursor:default;}' +
    '.a207u-toggle{display:inline-flex;align-items:center;gap:7px;min-height:36px;' +
      'padding:5px 12px 5px 6px;border:1px solid #ced4da;border-radius:20px;background:#fff;' +
      'cursor:pointer;font-size:13px;color:#343a40;}' +
    '.a207u-toggle.a207u-on{border-color:#1971c2;background:#eaf2fc;}' +
    '.a207u-toggle-track{position:relative;flex-shrink:0;width:34px;height:19px;' +
      'border-radius:10px;background:#ced4da;transition:background .15s;}' +
    '.a207u-toggle.a207u-on .a207u-toggle-track{background:#1971c2;}' +
    '.a207u-toggle-knob{position:absolute;top:2px;left:2px;width:15px;height:15px;' +
      'border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.35);transition:left .15s;}' +
    '.a207u-toggle.a207u-on .a207u-toggle-knob{left:17px;}' +
    '.a207u-toggle-label{white-space:nowrap;font-weight:600;}' +
    '.a207u-toggle.a207u-on .a207u-toggle-label{color:#1971c2;}' +
    '.a207u-navlabel{font-weight:700;font-size:15px;padding:0 6px;white-space:nowrap;}' +
    '.a207u-subinfo{color:#868e96;font-size:12px;margin:0 0 4px 2px;}' +
    '.a207u-dim{opacity:.35;pointer-events:none;}' +
    '.a207u-search{position:relative;display:inline-flex;align-items:center;}' +
    '.a207u-search input{min-height:36px;padding:6px 30px 6px 10px;border:1px solid #ced4da;' +
      'border-radius:6px;font-size:13px;width:200px;max-width:56vw;}' +
    '.a207u-clear{position:absolute;right:2px;top:50%;transform:translateY(-50%);border:none;' +
      'background:transparent;font-size:16px;padding:6px;cursor:pointer;color:#868e96;display:none;}' +
    '.a207u-select{min-height:36px;padding:6px;border:1px solid #ced4da;border-radius:6px;' +
      'background:#fff;font-size:13px;max-width:44vw;}' +
    '.a207u-warnbtn{border-color:#f08c00;color:#e8590c;font-weight:700;}' +
    '.a207u-warnbtn[data-zero="1"]{border-color:#ced4da;color:#adb5bd;font-weight:400;}' +
    '.a207u-switch{display:inline-flex;border:1px solid #4dabf7;border-radius:8px;' +
      'overflow:hidden;margin:4px 0;}' +
    '.a207u-switch button{border:none;background:#fff;color:#1971c2;padding:8px 14px;' +
      'min-height:40px;font-size:13px;cursor:pointer;border-right:1px solid #4dabf7;}' +
    '.a207u-switch button:last-child{border-right:none;}' +
    '.a207u-switch button.a207u-on{background:#1971c2;color:#fff;font-weight:700;}' +
    '.a207u-cnt{font-size:11px;opacity:.85;margin-left:3px;}' +
    '.a207u-legend{font-size:11px;color:#868e96;margin:2px 0 6px 2px;line-height:1.7;}' +
    '.a207u-note{background:#fff9db;border:1px solid #ffe066;border-radius:6px;' +
      'padding:6px 10px;margin:4px 0;font-size:12px;color:#5c4400;display:none;}' +
    '.a207u-warnpanel{background:#fff4e6;border:1px solid #ffc078;border-radius:6px;' +
      'padding:8px 10px;margin:4px 0;display:none;max-height:40vh;overflow:auto;}' +
    '.a207u-warnitem{padding:5px 0;border-bottom:1px dashed #ffd8a8;font-size:12px;}' +
    '.a207u-warnitem:last-child{border-bottom:none;}' +
    '.a207u-warntype{display:inline-block;background:#e8590c;color:#fff;border-radius:4px;' +
      'padding:1px 6px;font-size:11px;margin-right:6px;}' +
    '.a207u-warnitem a{color:#1971c2;margin-right:6px;text-decoration:none;}' +
    '.a207u-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;' +
      'border:1px solid #dee2e6;border-radius:6px;background:#fff;}' +
    'table.a207u-t{border-collapse:separate;border-spacing:0;width:auto;table-layout:auto;}' +
    'table.a207u-t th,table.a207u-t td{border-bottom:1px solid #e9ecef;' +
      'border-right:1px solid #f1f3f5;padding:3px 3px;text-align:center;' +
      'white-space:nowrap;background:#fff;font-size:11px;vertical-align:middle;}' +
    'table.a207u-t thead th{background:#f1f3f5;font-weight:700;position:relative;z-index:1;}' +
    '.a207u-fx1{position:sticky;left:0;z-index:3 !important;' +
      'box-shadow:2px 0 0 #e9ecef;text-align:left !important;white-space:nowrap;}' +
    'table.a207u-t thead .a207u-fx1{z-index:4 !important;}' +
    '.a207u-namewrap{display:inline-block;max-width:6em;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;}' +
    '.a207u-col-birth{width:66px;min-width:66px;max-width:66px;font-size:10px;letter-spacing:-.3px;}' +
    '.a207u-col-riyo{width:34px;min-width:34px;max-width:34px;}' +
    '.a207u-col-tanto{width:68px;min-width:68px;max-width:68px;}' +
    '.a207u-col-tanto .a207u-namewrap{max-width:5em;}' +
    '.a207u-col-py{width:78px;min-width:78px;max-width:78px;font-size:10px;}' +
    '.a207u-col-att{width:52px;min-width:52px;max-width:52px;font-size:10.5px;padding-left:2px;padding-right:2px;}' +
    'thead th.a207u-col-yearhead{background:#e7f5ff;color:#1864ab;font-size:11px;}' +
    'table.a207u-t tr.a207u-band td{background:#e7f5ff;color:#1864ab;font-weight:700;' +
      'text-align:left;padding:4px 8px;}' +
    '.a207u-band .a207u-bandin{position:sticky;left:8px;display:inline-block;}' +
    '.a207u-bdg{display:inline-block;border-radius:4px;padding:0 4px;font-size:10px;' +
      'color:#fff;margin:1px 2px 1px 0;white-space:nowrap;}' +
    '.a207u-bdg-birth{background:#f08c00;}' +
    '.a207u-bdg-new{background:#e64980;}' +
    '.a207u-yearsep{border-left:3px solid #4263eb !important;}' +
    '.a207u-status{display:inline-block;border-radius:4px;padding:0 4px;font-size:10px;' +
      'background:#adb5bd;color:#fff;margin-left:3px;}' +
    '.a207u-name a{color:#1971c2;text-decoration:none;font-weight:600;}' +
    '.a207u-mark-x{color:#adb5bd;}' +
    '.a207u-icon{margin-left:2px;font-size:10px;}' +
    '.a207u-cell a{display:block;text-decoration:none;color:inherit;min-height:22px;}' +
    'table.a207u-t td.a207u-merged{background:#d3f9d8;}' +
    'td.a207u-merged .a207u-maru{color:#2b8a3e;font-size:16px;font-weight:700;}' +
    'td.a207u-merged .a207u-mlabel{display:block;font-size:9px;color:#2b8a3e;}' +
    'td.a207u-pair .a207u-maru{color:#2b8a3e;font-size:14px;font-weight:700;}' +
    'table.a207u-t td.a207u-na{background:#f1f3f5;color:#adb5bd;font-size:11px;}' +
    'table.a207u-t td.a207u-missing{background:repeating-linear-gradient(45deg,#f1f3f5,#f1f3f5 6px,' +
      '#e9ecef 6px,#e9ecef 12px);color:#868e96;font-size:11px;}' +
    '.a207u-marks{display:inline-flex;flex-direction:column;gap:1px;line-height:1.2;}' +
    '.a207u-marks span{font-size:11px;}' +
    '.a207u-mlbl{color:#868e96;margin-right:2px;}' +
    '.a207u-loading{padding:40px 10px;text-align:center;color:#495057;}' +
    '.a207u-spin{display:inline-block;width:26px;height:26px;border:3px solid #dee2e6;' +
      'border-top-color:#1971c2;border-radius:50%;animation:a207uspin .8s linear infinite;' +
      'margin-bottom:10px;}' +
    '@keyframes a207uspin{to{transform:rotate(360deg);}}' +
    '.a207u-fatal{background:#fff5f5;border:1px solid #ffa8a8;border-radius:6px;' +
      'padding:14px;margin:8px 0;color:#c92a2a;font-size:13px;white-space:pre-wrap;}' +
    '.a207u-empty{padding:24px;text-align:center;color:#868e96;}';

  function injectStyle() {
    if (document.getElementById('a207u-style')) return;
    var st = document.createElement('style');
    st.id = 'a207u-style';
    st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  /* =====================================================================
   * Block 2/4  起動時検証・データ取得・モデル構築（純関数中心）
   * ===================================================================== */

  /* ------------------------------------------------------------------
   * レコード解析（設計図§6.1〜§6.3）
   *  戻り値:
   *   { ok:true, id, name, furigana, birthdayRaw, b, bIdx, birthM,
   *     riyousaki, tanto, status, zkRaw, kkRaw, zkIdx, kkIdx, py,
   *     counts:{ATT_...}, warnFlags:[{type,detail}] }
   *   / { ok:false, exclude:'silent'|'unclassified', id, name, birthdayRaw, detail }
   * ------------------------------------------------------------------ */
  function classifyRecord(record) {
    var F = CONFIG.FIELDS;
    var id = getStr(record, '$id') || (record.$id && record.$id.value) || '';
    var name = getStr(record, F.NAME);
    if (!name) {
      return { ok: false, exclude: 'silent', id: id, name: '', birthdayRaw: '', detail: '氏名が空' };
    }
    var birthdayRaw = getStr(record, F.BIRTHDAY);
    var b = birthdayRaw ? parseDate(birthdayRaw) : null;
    if (!b) {
      return {
        ok: false, exclude: 'unclassified', id: id, name: name, birthdayRaw: birthdayRaw,
        detail: birthdayRaw ? '生年月日の値が不正（' + birthdayRaw + '）' : '生年月日が空'
      };
    }
    var bIdx = monthIdx(b.y, b.m);

    var zkRaw = getStr(record, F.ZK_START);
    var kkRaw = getStr(record, F.KK_START);
    var zkD = zkRaw ? parseDate(zkRaw) : null;
    var kkD = kkRaw ? parseDate(kkRaw) : null;
    var zkInvalid = !!zkRaw && !zkD;
    var kkInvalid = !!kkRaw && !kkD;

    if (!zkD && !kkD) {
      if (!zkRaw && !kkRaw) {
        // 両方とも空欄: 入所前・入力途中の通常運用として警告なしで除外（確定: 非表示要望）
        return { ok: false, exclude: 'silent', id: id, name: name, birthdayRaw: birthdayRaw, detail: '前期・後期計画開始が両方とも空' };
      }
      var det = '前期・後期計画開始が両方とも不正（前期:' + (zkRaw || '空') + ' / 後期:' + (kkRaw || '空') + '）';
      return { ok: false, exclude: 'unclassified', id: id, name: name, birthdayRaw: birthdayRaw, detail: det };
    }

    var warnFlags = [];
    var zkIdx = zkD ? monthIdx(zkD.y, zkD.m) : null;
    var kkIdx = kkD ? monthIdx(kkD.y, kkD.m) : null;
    var pyZ = null, pyK = null;

    if (zkIdx != null) {
      var offZ = offsetInPlanYear(zkIdx, bIdx);
      pyZ = planYearOf(zkIdx, bIdx);
      if (offZ >= 6) {
        warnFlags.push({
          type: 'period_mismatch',
          detail: '前期計画開始（' + zkRaw + '）が後期期間（誕生月+' + offZ + 'ヶ月）に該当'
        });
      }
    }
    if (kkIdx != null) {
      var offK = offsetInPlanYear(kkIdx, bIdx);
      pyK = planYearOf(kkIdx, bIdx);
      if (offK <= 5) {
        warnFlags.push({
          type: 'period_mismatch',
          detail: '後期計画開始（' + kkRaw + '）が前期期間（誕生月+' + offK + 'ヶ月）に該当'
        });
      }
    }
    if (pyZ != null && pyK != null && pyZ !== pyK) {
      warnFlags.push({
        type: 'py_inconsistent',
        detail: '前期→' + pyZ + '年 / 後期→' + pyK + '年（前期側を採用）'
      });
    }
    if (zkInvalid && kkIdx != null) {
      warnFlags.push({ type: 'date_invalid', detail: '前期計画開始の値が不正（' + zkRaw + '）' });
    }
    if (kkInvalid && zkIdx != null) {
      warnFlags.push({ type: 'date_invalid', detail: '後期計画開始の値が不正（' + kkRaw + '）' });
    }

    var py = (pyZ != null) ? pyZ : pyK;

    var counts = {};
    ATT_KEYS.forEach(function (k) { counts[k] = fileCount(record, F[k]); });

    return {
      ok: true,
      id: id,
      name: name,
      furigana: getStr(record, F.FURIGANA),
      birthdayRaw: birthdayRaw,
      b: b, bIdx: bIdx, birthM: b.m,
      riyousaki: getStr(record, F.RIYOUSAKI),
      tanto: getStr(record, F.TANTO),
      status: getStr(record, F.STATUS),
      zkRaw: zkRaw, kkRaw: kkRaw,
      zkIdx: zkIdx, kkIdx: kkIdx,
      py: py,
      counts: counts,
      warnFlags: warnFlags
    };
  }

  /* ------------------------------------------------------------------
   * （児童×PY）グループの合算（設計図§6.4）
   * ------------------------------------------------------------------ */
  function mergeGroup(entries) {
    var counts = {};
    ATT_KEYS.forEach(function (k) { counts[k] = 0; });
    var hasZk = false, hasKk = false;
    var pairSet = {};
    var pairCount = 0;
    entries.forEach(function (e) {
      ATT_KEYS.forEach(function (k) { counts[k] += (e.counts[k] || 0); });
      if (e.zkIdx != null) hasZk = true;
      if (e.kkIdx != null) hasKk = true;
      var sig = (e.zkRaw || '') + '|' + (e.kkRaw || '');
      if (!pairSet[sig]) { pairSet[sig] = true; pairCount++; }
    });
    var rep = entries.reduce(function (a, b) {
      return Number(b.id) > Number(a.id) ? b : a;
    });
    var hasRecWarn = entries.some(function (e) { return e.warnFlags.length > 0; });
    return {
      entries: entries,
      counts: counts,
      hasZk: hasZk,
      hasKk: hasKk,
      rep: rep,
      merged: entries.length >= 2,
      dateMismatch: pairCount > 1,
      riyousaki: rep.riyousaki,
      tanto: rep.tanto,
      status: rep.status,
      furigana: rep.furigana,
      hasRecWarn: hasRecWarn,
      riyousakiState: 'ok' // buildModelで確定
    };
  }

  // 利用先の分類（設計図§7.3）
  function classifyRiyousaki(v) {
    if (!v) return 'empty';
    if (RIYOUSAKI_TABS.indexOf(v) >= 0) return 'ok';
    if (RIYOUSAKI_HIDDEN.indexOf(v) >= 0) return 'hidden';
    return 'unknown';
  }

  /* ------------------------------------------------------------------
   * モデル構築（設計図§6全体）
   *  records207: kintone生レコード配列 / records10: アプリ10生レコード配列
   * ------------------------------------------------------------------ */
  function buildModel(records207, records10) {
    var warnings = [];

    function addWarn(w) { warnings.push(w); }

    // --- 207レコード解析 ---
    var childMap = {}; // key -> child
    records207.forEach(function (raw) {
      var e = classifyRecord(raw);
      if (!e.ok) {
        if (e.exclude === 'unclassified') {
          addWarn({
            type: 'unclassified',
            name: e.name || '（氏名なし）',
            birthdayRaw: e.birthdayRaw || '',
            py: null, planStartIdx: null, pyText: '—',
            recordIds: [e.id], app10Ids: [],
            detail: e.detail
          });
        }
        return; // silent含め除外
      }
      var key = e.name + '_' + e.birthdayRaw;
      var child = childMap[key];
      if (!child) {
        child = {
          key: key,
          name: e.name,
          birthdayRaw: e.birthdayRaw,
          b: e.b, bIdx: e.bIdx, birthM: e.birthM,
          entriesByPy: {},
          groups: {},
          pyList: [],
          app10: { state: 'missing', id: null, ids: [] },
          current: null,
          minPY: null, maxPY: null
        };
        childMap[key] = child;
      }
      if (!child.entriesByPy[e.py]) child.entriesByPy[e.py] = [];
      child.entriesByPy[e.py].push(e);
    });

    // --- アプリ10 map（氏名+誕生日キー） ---
    var app10Map = {};
    records10.forEach(function (raw) {
      var nm = getStr(raw, CONFIG.CROSS.CHILD.NAME);
      var bd = getStr(raw, CONFIG.CROSS.CHILD.BIRTH);
      var id = getStr(raw, '$id') || (raw.$id && raw.$id.value) || '';
      if (!nm || !bd) return;
      var k = nm + '_' + bd;
      if (!app10Map[k]) app10Map[k] = [];
      app10Map[k].push({
        id: Number(id),
        contractRaw: getStr(raw, CONFIG.CROSS.CHILD.CONTRACT),
        statusRaw: getStr(raw, CONFIG.CROSS.CHILD.STATUS)
      });
    });

    // --- 児童ごとの集約 ---
    var children = [];
    Object.keys(childMap).forEach(function (key) {
      var child = childMap[key];
      var pys = Object.keys(child.entriesByPy).map(Number).sort(function (a, b) { return a - b; });
      child.pyList = pys;
      child.minPY = pys[0];
      child.maxPY = pys[pys.length - 1];

      pys.forEach(function (py) {
        var g = mergeGroup(child.entriesByPy[py]);
        g.py = py;
        g.planStartIdx = monthIdx(py, child.birthM);
        g.riyousakiState = classifyRiyousaki(g.riyousaki);
        child.groups[py] = g;

        var recIds = g.entries.map(function (e) { return e.id; });
        var pyText = pyLabel(py, child.birthM);

        // レコード単位の整合性警告
        g.entries.forEach(function (e) {
          e.warnFlags.forEach(function (wf) {
            addWarn({
              type: wf.type,
              name: child.name, birthdayRaw: child.birthdayRaw,
              py: py, planStartIdx: g.planStartIdx, pyText: pyText,
              recordIds: [e.id], app10Ids: [],
              detail: wf.detail
            });
          });
        });

        // 複数レコード合算: 警告パネルには出さず、行の🔗アイコンのみで表現（確定: 非表示要望）

        // 利用先チェック
        if (g.riyousakiState === 'empty') {
          addWarn({
            type: 'riyousaki_empty',
            name: child.name, birthdayRaw: child.birthdayRaw,
            py: py, planStartIdx: g.planStartIdx, pyText: pyText,
            recordIds: recIds, app10Ids: [],
            detail: '利用先が空欄のため一覧に表示していません'
          });
        } else if (g.riyousakiState === 'unknown') {
          addWarn({
            type: 'riyousaki_unknown',
            name: child.name, birthdayRaw: child.birthdayRaw,
            py: py, planStartIdx: g.planStartIdx, pyText: pyText,
            recordIds: recIds, app10Ids: [],
            detail: '利用先「' + g.riyousaki + '」は玉城/明和/訪問のみ以外の値のため非表示'
          });
        }
      });

      child.current = child.groups[child.maxPY];

      // --- アプリ10照合 ---
      var entries10 = (app10Map[key] || []).slice().sort(function (a, b) { return a.id - b.id; });
      var ids = entries10.map(function (e) { return e.id; });
      var latestStartIdx = monthIdx(child.maxPY, child.birthM);
      if (entries10.length === 0) {
        child.app10 = { state: 'missing', id: null, ids: [], contractRaw: '', statusRaw: '' };
        addWarn({
          type: 'app10_missing',
          name: child.name, birthdayRaw: child.birthdayRaw,
          py: child.maxPY, planStartIdx: latestStartIdx, pyText: pyLabel(child.maxPY, child.birthM),
          recordIds: [child.current.rep.id], app10Ids: [],
          detail: '氏名＋誕生日が一致する児童マスタ（アプリ' + CONFIG.CROSS.CHILD.APP_ID + '）レコードなし'
        });
      } else if (entries10.length === 1) {
        child.app10 = {
          state: 'ok', id: entries10[0].id, ids: ids,
          contractRaw: entries10[0].contractRaw, statusRaw: entries10[0].statusRaw
        };
      } else {
        var rep10 = entries10[entries10.length - 1];
        child.app10 = {
          state: 'ambiguous', id: rep10.id, ids: ids,
          contractRaw: rep10.contractRaw, statusRaw: rep10.statusRaw
        };
        addWarn({
          type: 'app10_ambiguous',
          name: child.name, birthdayRaw: child.birthdayRaw,
          py: child.maxPY, planStartIdx: latestStartIdx, pyText: pyLabel(child.maxPY, child.birthM),
          recordIds: [child.current.rep.id], app10Ids: ids,
          detail: '同姓同名かつ同一誕生日のマスタが' + ids.length + '件（最新No.' + ids[ids.length - 1] + 'へ暫定リンク）'
        });
      }

      // 有効ステータス（判定用。アプリ10「利用状況」を優先し、空欄ならアプリ207側の
      // 最新レコードの利用状況にフォールバックする。確定仕様: アプリ10側が正）
      child.effectiveStatus = child.app10.statusRaw || child.current.status;

      children.push(child);
    });

    return { children: children, childMap: childMap, warnings: warnings };
  }

  /* ------------------------------------------------------------------
   * 月→行の展開（単月表示。設計図改訂: 7ヶ月ウィンドウ→月単位表示）
   *  1回の表示は常に1ヶ月のみ。児童は「誕生月」型 or 「半年後」型の
   *  いずれか一方でその月に該当する（両方同時に該当することはない）。
   * ------------------------------------------------------------------ */
  function rowFrom(child, py, group, type, placeholder) {
    var src = group || child.current;
    return {
      child: child,
      py: py,
      type: type,             // 'birth' | 'half'
      group: group,
      placeholder: !!placeholder,
      riyousaki: src.riyousaki,
      riyousakiState: src.riyousakiState,
      tanto: src.tanto,
      furigana: src.furigana,
      status: placeholder ? child.current.status : src.status
    };
  }

  function expandWindowRows(model, monthIdx_) {
    var rows = [];
    var ym = idxToYM(monthIdx_);
    var halfSrc = idxToYM(monthIdx_ - 6);
    model.children.forEach(function (child) {
      var type = null, py = null;
      if (ym.m === child.birthM) {
        type = 'birth'; py = ym.y;
      } else if (halfSrc.m === child.birthM) {
        type = 'half'; py = halfSrc.y;
      } else {
        return; // この月には該当しない
      }
      var group = child.groups[py] || null;
      if (group) {
        rows.push(rowFrom(child, py, group, type, false));
      } else if (child.effectiveStatus === STATUS_ACTIVE && py >= child.minPY) {
        rows.push(rowFrom(child, py, null, type, true));
      }
    });
    return rows;
  }

  // 検索モード用: 全期間の実レコード行（設計図§7.5）
  function buildSearchRows(model) {
    var rows = [];
    model.children.forEach(function (child) {
      child.pyList.forEach(function (py) {
        rows.push(rowFrom(child, py, child.groups[py], null, false));
      });
    });
    return rows;
  }

  /* ------------------------------------------------------------------
   * 4段階統合の判定（設計図§8.7）
   *  group: { counts, hasZk, hasKk } を受け、セル配列を返す（純関数）
   *  cell: {span, kind:'merged'|'pair'|'marks'|'none'|'na', label?, cls?, an?, sign?}
   * ------------------------------------------------------------------ */
  function resolveMergeLevel(group) {
    var c = group.counts;
    function n(k) { return c[k] || 0; }
    function ok(k) { return n(k) >= 1; }

    var pairZk = ok('ATT_ZK_AN') && ok('ATT_ZK_SIGN');
    var pairZh = ok('ATT_ZH_AN') && ok('ATT_ZH_SIGN');
    var pairKk = ok('ATT_KK_AN') && ok('ATT_KK_SIGN');
    var pairKh = ok('ATT_KH_AN') && ok('ATT_KH_SIGN');

    var zenkiFiles = ZENKI_KEYS.reduce(function (s, k) { return s + n(k); }, 0);
    // 前期対象外: 前期開始が空・後期開始あり・かつ前期側に添付が1件もない（安全ガード）
    var taishogai = !group.hasZk && group.hasKk && zenkiFiles === 0;

    var zenki4 = pairZk && pairZh;
    var kouki4 = pairKk && pairKh;

    if (!taishogai && zenki4 && kouki4) {
      return [{ span: 4, kind: 'merged', label: '年間', cls: 'a207u-m8', title: '全8点保存済み' }];
    }
    var cells = [];
    if (taishogai) {
      cells.push({ span: 2, kind: 'na', title: '年度途中入所のため前期は対象外' });
    } else if (zenki4) {
      cells.push({ span: 2, kind: 'merged', label: '前期', cls: 'a207u-m4', title: '前期4点保存済み' });
    } else {
      cells.push(slotCell(pairZk, n('ATT_ZK_AN'), n('ATT_ZK_SIGN'), '前期立案'));
      cells.push(slotCell(pairZh, n('ATT_ZH_AN'), n('ATT_ZH_SIGN'), '前期評価'));
    }
    if (kouki4) {
      cells.push({ span: 2, kind: 'merged', label: '後期', cls: 'a207u-m4', title: '後期4点保存済み' });
    } else {
      cells.push(slotCell(pairKk, n('ATT_KK_AN'), n('ATT_KK_SIGN'), '後期立案'));
      cells.push(slotCell(pairKh, n('ATT_KH_AN'), n('ATT_KH_SIGN'), '後期評価'));
    }
    return cells;
  }

  function slotCell(pair, an, sign, label) {
    if (pair) return { span: 1, kind: 'pair', title: label + '：案＋サイン済 保存済み' };
    if (an === 0 && sign === 0) return { span: 1, kind: 'none', title: label + '：未保存' };
    return { span: 1, kind: 'marks', an: an, sign: sign, title: label };
  }

  /* ------------------------------------------------------------------
   * 担当フィルタ（設計図§7.4）
   * ------------------------------------------------------------------ */
  function buildTantoOptions(rows) {
    var set = {};
    var hasNone = false;
    rows.forEach(function (r) {
      if (r.tanto) set[r.tanto] = true;
      else hasNone = true;
    });
    var list = Object.keys(set).sort(jaCompare);
    return { list: list, hasNone: hasNone };
  }

  function resolveInitialTanto(loginName, options) {
    if (loginName && options.list.indexOf(loginName) >= 0) return loginName;
    return TANTO_ALL;
  }

  function tantoPass(row, tanto) {
    if (tanto === TANTO_ALL) return true;
    if (tanto === TANTO_NONE) return !row.tanto;
    return row.tanto === tanto;
  }

  // 利用先スイッチによる行の可否（設計図§7.3）
  function riyousakiPass(row, sw) {
    if (row.riyousakiState !== 'ok') return false; // empty/hidden/unknown は常に非表示
    if (sw === RIYOUSAKI_BOTH) return true;
    return row.riyousaki === sw;
  }

  /* ------------------------------------------------------------------
   * 警告の表示範囲（設計図§8.9）
   * ------------------------------------------------------------------ */
  // 警告は、その行が実際にテーブルに現れる月（誕生月 または 誕生月+6ヶ月）と
  // 完全に一致する場合のみ表示する（v3改訂: 従来の「PYの12ヶ月スパンと交差」だと
  // 無関係な月にも警告が出てしまっていたため厳密化）。
  function isWarningVisibleForWindow(w, monthIdx_) {
    if (w.planStartIdx == null) return true;
    return monthIdx_ === w.planStartIdx || monthIdx_ === w.planStartIdx + 6;
  }

  /* ------------------------------------------------------------------
   * データ取得（シーク法・設計図§5）
   * ------------------------------------------------------------------ */
  function apiUrl(path) {
    return kintone.api.url(path, true);
  }

  function fetchAllFrom(appId, fields, onProgress) {
    var all = [];
    var lastId = 0;
    function step() {
      return kintone.api(apiUrl('/k/v1/records.json'), 'GET', {
        app: appId,
        query: '$id > ' + lastId + ' order by $id asc limit 500',
        fields: fields.concat(['$id'])
      }).then(function (resp) {
        var recs = resp.records || [];
        for (var i = 0; i < recs.length; i++) all.push(recs[i]);
        if (onProgress) onProgress(all.length);
        if (recs.length === 500) {
          lastId = Number(recs[recs.length - 1].$id.value);
          return step();
        }
        return all;
      });
    }
    return step();
  }

  /* ------------------------------------------------------------------
   * 起動時検証（設計図§3.4）
   * ------------------------------------------------------------------ */
  function validateForm(appId) {
    return Promise.all([
      kintone.api(apiUrl('/k/v1/app/form/fields.json'), 'GET', { app: appId }),
      kintone.api(apiUrl('/k/v1/app/form/fields.json'), 'GET', { app: CONFIG.CROSS.CHILD.APP_ID })
    ]).then(function (res) {
      var errs = [];
      var props207 = res[0].properties || {};
      Object.keys(CONFIG.FIELDS).forEach(function (key) {
        var code = CONFIG.FIELDS[key];
        var expect = CONFIG.FIELD_TYPES[key];
        var p = props207[code];
        if (!p) errs.push('アプリ' + appId + ': フィールド「' + code + '」が存在しません');
        else if (p.type !== expect) {
          errs.push('アプリ' + appId + ': 「' + code + '」の型が ' + p.type + '（期待: ' + expect + '）');
        }
      });
      var props10 = res[1].properties || {};
      var C = CONFIG.CROSS.CHILD;
      [[C.NAME, C.NAME_TYPE], [C.BIRTH, C.BIRTH_TYPE], [C.CONTRACT, C.CONTRACT_TYPE],
        [C.STATUS, C.STATUS_TYPE]].forEach(function (pair) {
        var p = props10[pair[0]];
        if (!p) errs.push('アプリ' + C.APP_ID + ': フィールド「' + pair[0] + '」が存在しません');
        else if (p.type !== pair[1]) {
          errs.push('アプリ' + C.APP_ID + ': 「' + pair[0] + '」の型が ' + p.type + '（期待: ' + pair[1] + '）');
        }
      });
      if (errs.length) {
        var err = new Error('フィールド定義の検証に失敗しました');
        err.a207uFatal = errs;
        throw err;
      }
    });
  }

  /* =====================================================================
   * Block 3/4  描画
   * ===================================================================== */

  var state = {
    appId: null,
    loginName: '',
    windowStart: null,        // 月インデックス（S）
    riyousaki: RIYOUSAKI_TABS[0],
    tanto: TANTO_ALL,
    search: '',
    warnOpen: false,
    model: null,
    windowRows: [],           // 現在ウィンドウの全行（フィルタ前）
    searchRows: [],           // 全期間の実レコード行
    initialTantoApplied: false,
    savedScroll: null,
    showSecondary: false      // 中学生以上（中学1年〜18歳以上）の表示切替。既定は非表示
  };

  var ui = {};                // 主要DOM参照

  function todayIdx() {
    var now = new Date();
    return monthIdx(now.getFullYear(), now.getMonth() + 1);
  }

  /* ---------------- シェル構築 ---------------- */
  function renderShell(root) {
    clearEl(root);
    var wrap = el('div', { 'class': 'a207u-wrap' });

    // ナビ行
    ui.navBar = el('div', { 'class': 'a207u-bar a207u-navbar' });
    ui.btnPrev6 = navBtn('«', -STEP_LARGE, '6ヶ月戻る');
    ui.btnPrev1 = navBtn('‹', -STEP_SMALL, '1ヶ月戻る');
    ui.navLabel = el('span', { 'class': 'a207u-navlabel' });
    ui.btnNext1 = navBtn('›', STEP_SMALL, '1ヶ月進む');
    ui.btnNext6 = navBtn('»', STEP_LARGE, '6ヶ月進む');
    ui.btnToday = el('button', { 'class': 'a207u-btn', type: 'button', text: '今月' });
    ui.btnToday.addEventListener('click', function () {
      if (isSearching()) return;
      state.windowStart = todayIdx();
      onWindowMoved();
    });
    // 中学生以上の表示切替（既定は非表示。0歳児〜小学生を中心に見せるため）
    ui.btnSecondary = el('button', {
      'class': 'a207u-toggle', type: 'button', 'aria-pressed': 'false',
      title: '中学1年〜18歳以上の行の表示/非表示を切り替え'
    }, [
      el('span', { 'class': 'a207u-toggle-track' }, [el('span', { 'class': 'a207u-toggle-knob' })]),
      el('span', { 'class': 'a207u-toggle-label', text: '中学生以上' })
    ]);
    ui.btnSecondary.addEventListener('click', function () {
      state.showSecondary = !state.showSecondary;
      updateSecondaryBtn();
      updateTable();
    });
    ui.navBar.appendChild(ui.btnPrev6);
    ui.navBar.appendChild(ui.btnPrev1);
    ui.navBar.appendChild(ui.navLabel);
    ui.navBar.appendChild(ui.btnNext1);
    ui.navBar.appendChild(ui.btnNext6);
    ui.navBar.appendChild(ui.btnToday);
    ui.navBar.appendChild(ui.btnSecondary);
    wrap.appendChild(ui.navBar);

    // ツールバー行（検索・担当・再読込・警告）
    var tool = el('div', { 'class': 'a207u-bar a207u-toolbar' });
    var searchWrap = el('span', { 'class': 'a207u-search' });
    ui.searchInput = el('input', { type: 'text', placeholder: '氏名・フリガナで検索' });
    ui.searchClear = el('button', { 'class': 'a207u-clear', type: 'button', text: '✕', title: '検索をクリア' });
    ui.searchInput.addEventListener('input', debounce(function () {
      state.search = ui.searchInput.value;
      onSearchChanged();
    }, 200));
    ui.searchClear.addEventListener('click', function () {
      ui.searchInput.value = '';
      state.search = '';
      onSearchChanged();
    });
    searchWrap.appendChild(ui.searchInput);
    searchWrap.appendChild(ui.searchClear);
    tool.appendChild(searchWrap);

    ui.tantoSelect = el('select', { 'class': 'a207u-select', title: '担当で絞り込み' });
    ui.tantoSelect.addEventListener('change', function () {
      state.tanto = ui.tantoSelect.value;
      updateSwitch();
      updateTable();
      saveState();
    });
    tool.appendChild(ui.tantoSelect);

    ui.btnReload = el('button', { 'class': 'a207u-btn', type: 'button', text: '再読込' });
    ui.btnReload.addEventListener('click', function () { loadData(true); });
    tool.appendChild(ui.btnReload);

    ui.warnBtn = el('button', { 'class': 'a207u-btn a207u-warnbtn', type: 'button', text: '⚠ 0' });
    ui.warnBtn.addEventListener('click', function () {
      state.warnOpen = !state.warnOpen;
      updateWarnings();
    });
    tool.appendChild(ui.warnBtn);
    wrap.appendChild(tool);

    // 学年基準
    ui.subInfo = el('div', { 'class': 'a207u-subinfo' });
    wrap.appendChild(ui.subInfo);

    // 利用先スイッチ
    ui.switchBox = el('div', { 'class': 'a207u-switch' });
    ui.switchBtns = {};
    RIYOUSAKI_TABS.concat([RIYOUSAKI_BOTH]).forEach(function (v) {
      var b = el('button', { type: 'button' });
      b.appendChild(el('span', { text: v }));
      var cnt = el('span', { 'class': 'a207u-cnt', text: '' });
      b.appendChild(cnt);
      b.addEventListener('click', function () {
        state.riyousaki = v;
        updateTantoOptions();
        updateSwitch();
        updateTable();
        saveState();
      });
      ui.switchBtns[v] = { btn: b, cnt: cnt };
      ui.switchBox.appendChild(b);
    });
    wrap.appendChild(ui.switchBox);

    // 凡例
    ui.legend = el('div', {
      'class': 'a207u-legend',
      text: '〔誕〕＝誕生月（年間計画の更新月）　〔新〕＝新規利用（アプリ10契約日が当年度）　' +
        '🔗複数レコード合算　⚠要確認（詳細は警告パネル）　△児童マスタ未一致　— 対象外（年度途中入所）　' +
        '「中学生以上」ボタンで中学1年〜18歳以上の表示/非表示を切替（既定は非表示）'
    });
    wrap.appendChild(ui.legend);

    // 警告パネル
    ui.warnPanel = el('div', { 'class': 'a207u-warnpanel' });
    wrap.appendChild(ui.warnPanel);

    // 検索中バナー
    ui.searchNote = el('div', {
      'class': 'a207u-note',
      text: '検索結果を全期間から表示しています（利用先・担当は現在の絞り込みを継続）'
    });
    wrap.appendChild(ui.searchNote);

    // テーブル
    ui.tableWrap = el('div', { 'class': 'a207u-tablewrap' });
    wrap.appendChild(ui.tableWrap);

    root.appendChild(wrap);

    // スクロール保存
    var saveScroll = debounce(saveState, 300);
    ui.tableWrap.addEventListener('scroll', saveScroll);
    window.addEventListener('scroll', saveScroll, { passive: true });
  }

  function navBtn(label, step, title) {
    var b = el('button', { 'class': 'a207u-btn', type: 'button', text: label, title: title });
    b.addEventListener('click', function () {
      if (isSearching()) return;
      state.windowStart += step;
      onWindowMoved();
    });
    return b;
  }

  /* ---------------- 更新関数群（設計図§10のマトリクスに対応） ---------------- */

  function recomputeWindowRows() {
    state.windowRows = expandWindowRows(state.model, state.windowStart);
  }

  function onWindowMoved() {
    recomputeWindowRows();
    updateNav();
    updateTantoOptions();
    updateSwitch();
    updateWarnings();
    updateTable();
    saveState();
  }

  function onSearchChanged() {
    updateSearchUI();
    updateTable();
  }

  function updateNav() {
    var s = idxToYM(state.windowStart);
    ui.navLabel.textContent = s.y + '年' + s.m + '月';
    var fy = fiscalYearOfIdx(state.windowStart);
    ui.subInfo.textContent = '学年基準: ' + fy + '年度';
  }

  function updateSearchUI() {
    var searching = isSearching();
    ui.searchNote.style.display = searching ? 'block' : 'none';
    ui.searchClear.style.display = String(state.search || '') ? 'block' : 'none';
    var navEls = [ui.btnPrev6, ui.btnPrev1, ui.btnNext1, ui.btnNext6, ui.btnToday, ui.navLabel];
    navEls.forEach(function (n) {
      if (searching) n.classList.add('a207u-dim');
      else n.classList.remove('a207u-dim');
    });
  }

  function isSearching() {
    return !!String(state.search || '').replace(/[\s\u3000]/g, '');
  }

  // 表示対象行（利用先・担当フィルタ適用後）を返す
  function visibleRows() {
    var base;
    if (isSearching()) {
      var q = state.search;
      base = state.searchRows.filter(function (r) {
        return matchesSearch(r.child.name, r.furigana, q);
      });
    } else {
      base = state.windowRows;
    }
    var sw = state.riyousaki;
    var tanto = state.tanto;
    return base.filter(function (r) {
      return riyousakiPass(r, sw) && tantoPass(r, tanto);
    });
  }

  function updateTantoOptions() {
    // 利用先スイッチが玉城/明和のときはその利用先の行だけに絞り込む。
    // 「両方」のときは従来通り利用先を問わず全件から選択肢を生成する。
    var sw = state.riyousaki;
    var eligible = state.windowRows.filter(function (r) {
      if (r.riyousakiState !== 'ok') return false;
      if (sw === RIYOUSAKI_BOTH) return true;
      return r.riyousaki === sw;
    });
    var opts = buildTantoOptions(eligible);

    // 初回のみログイン名で初期化（確定仕様）
    if (!state.initialTantoApplied) {
      state.tanto = resolveInitialTanto(state.loginName, opts);
      state.initialTantoApplied = true;
    }

    clearEl(ui.tantoSelect);
    ui.tantoSelect.appendChild(el('option', { value: TANTO_ALL, text: '全担当' }));
    opts.list.forEach(function (t) {
      ui.tantoSelect.appendChild(el('option', { value: t, text: t }));
    });
    if (opts.hasNone) {
      ui.tantoSelect.appendChild(el('option', { value: TANTO_NONE, text: '（担当未設定）' }));
    }
    // 選択維持: 現ウィンドウに存在しない選択値は「（範囲外）」で固定表示
    var cur = state.tanto;
    if (cur !== TANTO_ALL) {
      var exists = (cur === TANTO_NONE) ? opts.hasNone : (opts.list.indexOf(cur) >= 0);
      if (!exists) {
        var label = (cur === TANTO_NONE) ? '（担当未設定）（範囲外）' : cur + '（範囲外）';
        ui.tantoSelect.appendChild(el('option', { value: cur, text: label }));
      }
    }
    ui.tantoSelect.value = state.tanto;
  }

  function updateSecondaryBtn() {
    var on = state.showSecondary;
    ui.btnSecondary.classList.toggle('a207u-on', on);
    ui.btnSecondary.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = ui.btnSecondary.querySelector('.a207u-toggle-label');
    label.textContent = on ? '中学生以上：表示' : '中学生以上：非表示';
  }

  function updateSwitch() {
    // 人数バッジ = 担当フィルタ適用後のウィンドウ内行数（設計図§8.3）
    var counts = {};
    RIYOUSAKI_TABS.forEach(function (t) { counts[t] = 0; });
    state.windowRows.forEach(function (r) {
      if (r.riyousakiState !== 'ok') return;
      if (!tantoPass(r, state.tanto)) return;
      if (counts[r.riyousaki] != null) counts[r.riyousaki]++;
    });
    var total = RIYOUSAKI_TABS.reduce(function (s, t) { return s + counts[t]; }, 0);
    RIYOUSAKI_TABS.forEach(function (t) {
      ui.switchBtns[t].cnt.textContent = '(' + counts[t] + ')';
      ui.switchBtns[t].btn.className = (state.riyousaki === t) ? 'a207u-on' : '';
    });
    ui.switchBtns[RIYOUSAKI_BOTH].cnt.textContent = '(' + total + ')';
    ui.switchBtns[RIYOUSAKI_BOTH].btn.className =
      (state.riyousaki === RIYOUSAKI_BOTH) ? 'a207u-on' : '';
  }

  function updateWarnings() {
    var visible = state.model.warnings.filter(function (w) {
      return isWarningVisibleForWindow(w, state.windowStart);
    });
    visible.sort(function (a, b) {
      var t = WARN_TYPE_ORDER.indexOf(a.type) - WARN_TYPE_ORDER.indexOf(b.type);
      if (t) return t;
      var n = jaCompare(a.name, b.name);
      if (n) return n;
      return (a.py || 0) - (b.py || 0);
    });
    ui.warnBtn.textContent = '⚠ ' + visible.length;
    ui.warnBtn.setAttribute('data-zero', visible.length === 0 ? '1' : '0');

    clearEl(ui.warnPanel);
    ui.warnPanel.style.display = state.warnOpen ? 'block' : 'none';
    if (!state.warnOpen) return;

    if (visible.length === 0) {
      ui.warnPanel.appendChild(el('div', { 'class': 'a207u-warnitem', text: '表示範囲に警告はありません。' }));
      return;
    }
    visible.forEach(function (w) {
      var item = el('div', { 'class': 'a207u-warnitem' });
      item.appendChild(el('span', { 'class': 'a207u-warntype', text: WARN_TYPE_LABELS[w.type] || w.type }));
      item.appendChild(el('span', {
        text: w.name + '（' + (w.birthdayRaw || '生年月日なし') + '）／' + (w.pyText || '—') + '／' + w.detail + '　'
      }));
      (w.recordIds || []).forEach(function (id) {
        item.appendChild(el('a', {
          href: recordUrl(state.appId, id), target: '_blank', rel: 'noopener',
          text: 'No.' + id
        }));
      });
      (w.app10Ids || []).forEach(function (id) {
        item.appendChild(el('a', {
          href: recordUrl(CONFIG.CROSS.CHILD.APP_ID, id), target: '_blank', rel: 'noopener',
          text: 'マスタNo.' + id
        }));
      });
      ui.warnPanel.appendChild(item);
    });
  }

  /* ---------------- テーブル描画 ---------------- */

  function updateTable() {
    var searching = isSearching();
    var showRiyousakiCol = (state.riyousaki === RIYOUSAKI_BOTH);
    var rows = visibleRows();

    // 学年基準年度
    var fy = fiscalYearOfIdx(state.windowStart);

    // 学年を先に算出（以降のフィルタ・ソートで使うため）
    rows.forEach(function (r) {
      r.gradeIdx = computeGrade(r.child.b, fy);
    });

    // 通常モード（月表示）のみ: 「当年度のレコードが無く、かつ利用中でもない」行は
    // 前年度分のみの過去データで実務上のアクションが無いため一覧から除外する
    // （例: 前年度末に終結した児童が、半年後型などで翌年度以降も表示され続けてしまう不具合の修正）。
    if (!searching) {
      rows = rows.filter(function (r) {
        var hasCurrentYear = !!r.child.groups[fy];
        return hasCurrentYear || r.child.effectiveStatus === STATUS_ACTIVE;
      });
    }

    // 中学生以上（中学1年〜18歳以上）の表示切替。既定は非表示。学年不明は常に表示。
    // 検索モードは対象外（名前で明示的に探しているので学年に関わらず見つけられるようにする）。
    if (!searching && !state.showSecondary) {
      rows = rows.filter(function (r) {
        return r.gradeIdx < GRADE_SECONDARY_START || r.gradeIdx === GRADE_UNKNOWN;
      });
    }

    // ソートキー（学年 → 型(誕生月を先・半年後を後) → 誕生月、の順）
    rows.sort(function (a, b) {
      if (a.gradeIdx !== b.gradeIdx) return a.gradeIdx - b.gradeIdx;
      var ta = (a.type === 'half') ? 1 : 0;
      var tb = (b.type === 'half') ? 1 : 0;
      if (ta !== tb) return ta - tb;
      if (a.child.birthM !== b.child.birthM) return a.child.birthM - b.child.birthM;
      var f = jaCompare(a.furigana, b.furigana);
      if (f) return f;
      var n = jaCompare(a.child.name, b.child.name);
      if (n) return n;
      return a.py - b.py;
    });

    clearEl(ui.tableWrap);

    if (rows.length === 0) {
      ui.tableWrap.appendChild(el('div', { 'class': 'a207u-empty', text: '該当なし' }));
      return;
    }

    var table = el('table', { 'class': 'a207u-t' });

    var thead;
    if (searching) {
      var headCells = [];
      headCells.push(th('プラン年', 'a207u-col-py'));
      headCells.push(th('氏名', 'a207u-fx1'));
      headCells.push(th('生年月日', 'a207u-col-birth'));
      if (showRiyousakiCol) headCells.push(th('利用先', 'a207u-col-riyo'));
      headCells.push(th('担当', 'a207u-col-tanto'));
      headCells.push(th('前期立案', 'a207u-col-att'));
      headCells.push(th('前期評価', 'a207u-col-att'));
      headCells.push(th('後期立案', 'a207u-col-att'));
      headCells.push(th('後期評価', 'a207u-col-att'));
      thead = el('thead', null, [el('tr', null, headCells)]);
    } else {
      // 1行目: 固定列はrowspan2、添付列は「前年度」「当年度」の年度見出し(colspan4)
      var topRow = [];
      topRow.push(th('氏名', 'a207u-fx1', { rowspan: '2' }));
      topRow.push(th('生年月日', 'a207u-col-birth', { rowspan: '2' }));
      if (showRiyousakiCol) topRow.push(th('利用先', 'a207u-col-riyo', { rowspan: '2' }));
      topRow.push(th('担当', 'a207u-col-tanto', { rowspan: '2' }));
      topRow.push(th((fy - 1) + '年度', 'a207u-col-yearhead', { colspan: '4' }));
      topRow.push(th(fy + '年度', 'a207u-col-yearhead a207u-yearsep', { colspan: '4' }));
      // 2行目: 前期立案/前期評価/後期立案/後期評価 を年度分（前年度・当年度）繰り返す
      var subRow = [];
      [0, 1].forEach(function (yi) {
        subRow.push(th('前期立案', 'a207u-col-att' + (yi === 1 ? ' a207u-yearsep' : '')));
        subRow.push(th('前期評価', 'a207u-col-att'));
        subRow.push(th('後期立案', 'a207u-col-att'));
        subRow.push(th('後期評価', 'a207u-col-att'));
      });
      thead = el('thead', null, [el('tr', null, topRow), el('tr', null, subRow)]);
    }
    table.appendChild(thead);

    var fixedColCount = 3 + (searching ? 1 : 0) + (showRiyousakiCol ? 1 : 0); // 先頭〜担当まで
    var totalColCount = fixedColCount + (searching ? 4 : 8);

    var tbody = el('tbody');
    var lastGrade = -1;
    rows.forEach(function (r) {
      if (r.gradeIdx !== lastGrade) {
        lastGrade = r.gradeIdx;
        var bandTd = el('td', { colspan: String(totalColCount) });
        bandTd.appendChild(el('span', { 'class': 'a207u-bandin', text: GRADE_MASTER[r.gradeIdx] }));
        tbody.appendChild(el('tr', { 'class': 'a207u-band' }, [bandTd]));
      }
      tbody.appendChild(renderRow(r, searching, showRiyousakiCol, fy));
    });
    table.appendChild(tbody);
    ui.tableWrap.appendChild(table);
  }

  function th(text, cls, extraAttrs) {
    var attrs = { 'class': cls || null, text: text };
    if (extraAttrs) {
      Object.keys(extraAttrs).forEach(function (k) { attrs[k] = extraAttrs[k]; });
    }
    return el('th', attrs);
  }

  function renderRow(r, searching, showRiyousakiCol, fy) {
    var tr = el('tr');

    // 検索モードのみ: 先頭にプラン年列（非固定）
    if (searching) {
      tr.appendChild(el('td', { 'class': 'a207u-col-py', text: pyLabel(r.py, r.child.birthM) }));
    }

    // 氏名列（固定列はこれ1つのみ。誕生月バッジ・新規バッジは氏名の直前にインラインで配置）
    var nameTd = el('td', { 'class': 'a207u-fx1 a207u-name' });
    if (!searching && r.type === 'birth') {
      nameTd.appendChild(el('span', {
        'class': 'a207u-bdg a207u-bdg-birth', text: '誕',
        title: '誕生月＝年間計画の更新月'
      }));
    }
    var app10 = r.child.app10;
    if (isNewEnrollment(app10.contractRaw, fy)) {
      nameTd.appendChild(el('span', {
        'class': 'a207u-bdg a207u-bdg-new', text: '新',
        title: '新規利用（アプリ10 契約日: ' + app10.contractRaw + ' が ' + fy + '年度）'
      }));
    }
    var nameInner = el('span', { 'class': 'a207u-namewrap', title: r.child.name, text: r.child.name });
    if (app10.state === 'ok' || app10.state === 'ambiguous') {
      var nameLink = el('a', {
        href: recordUrl(CONFIG.CROSS.CHILD.APP_ID, app10.id),
        target: '_blank', rel: 'noopener'
      });
      nameLink.appendChild(nameInner);
      nameTd.appendChild(nameLink);
    } else {
      nameTd.appendChild(nameInner);
    }
    if (app10.state === 'missing') {
      nameTd.appendChild(el('span', { 'class': 'a207u-icon', text: '△', title: '児童マスタに一致なし' }));
    }
    if (r.group && r.group.merged) {
      nameTd.appendChild(el('span', {
        'class': 'a207u-icon', text: '🔗',
        title: '複数レコードを合算表示（No.' + r.group.entries.map(function (e) { return e.id; }).join(', ') + '）'
      }));
    }
    var hasWarn = (app10.state === 'ambiguous') ||
      (r.group && (r.group.hasRecWarn || r.group.dateMismatch));
    if (hasWarn) {
      nameTd.appendChild(el('span', { 'class': 'a207u-icon', text: '⚠', title: '要確認（警告パネル参照）' }));
    }
    if (r.status && r.status !== STATUS_ACTIVE) {
      nameTd.appendChild(el('span', { 'class': 'a207u-status', text: r.status }));
    }
    tr.appendChild(nameTd);

    // 生年月日
    tr.appendChild(el('td', { 'class': 'a207u-col-birth', text: r.child.birthdayRaw }));

    // 利用先（両方スイッチ時のみ）
    if (showRiyousakiCol) {
      tr.appendChild(el('td', { 'class': 'a207u-col-riyo', text: r.riyousaki }));
    }

    // 担当（氏名と同様に幅を絞り、はみ出す場合は…で省略）
    var tantoTd = el('td', { 'class': 'a207u-col-tanto' });
    tantoTd.appendChild(el('span', {
      'class': 'a207u-namewrap', title: r.tanto || '', text: r.tanto || '—'
    }));
    tr.appendChild(tantoTd);

    if (searching) {
      // 検索モード: 従来通りその行自身のPYのみ4列
      if (r.placeholder) {
        tr.appendChild(el('td', {
          'class': 'a207u-missing', colspan: '4',
          text: 'レコード未作成', title: '利用中の児童ですが、このプラン年のレコードが見つかりません'
        }));
        return tr;
      }
      var link0 = recordUrl(state.appId, r.group.rep.id);
      resolveMergeLevel(r.group).forEach(function (cell) {
        tr.appendChild(renderSlotCell(cell, link0));
      });
      return tr;
    }

    // 通常モード: 前年度(fy-1)・当年度(fy)の2年分、各4列を表示（設計図v6改訂）
    [fy - 1, fy].forEach(function (y, yi) {
      var g = r.child.groups[y] || null;
      var yearCells = [];
      if (g) {
        var link = recordUrl(state.appId, g.rep.id);
        resolveMergeLevel(g).forEach(function (cell) {
          yearCells.push(renderSlotCell(cell, link));
        });
      } else if (r.child.effectiveStatus === STATUS_ACTIVE && y >= r.child.minPY) {
        yearCells.push(el('td', {
          'class': 'a207u-missing', colspan: '4',
          text: '未作成', title: y + '年度は利用中ですが、このプラン年のレコードが見つかりません'
        }));
      } else {
        yearCells.push(el('td', {
          'class': 'a207u-na', colspan: '4', text: '－',
          title: y + '年度はこの児童のプラン年に該当しません'
        }));
      }
      if (yi === 1 && yearCells.length) {
        yearCells[0].className = (yearCells[0].className + ' a207u-yearsep').trim();
      }
      yearCells.forEach(function (td) { tr.appendChild(td); });
    });
    return tr;
  }

  function renderSlotCell(cell, link) {
    var td = el('td', { colspan: String(cell.span), title: cell.title || null });
    if (cell.kind === 'na') {
      td.className = 'a207u-na';
      td.textContent = '— 対象外';
      return td;
    }
    var a = el('a', { href: link, target: '_blank', rel: 'noopener' });
    if (cell.kind === 'merged') {
      td.className = 'a207u-merged a207u-cell';
      a.appendChild(el('span', { 'class': 'a207u-maru', text: '〇' }));
      a.appendChild(el('span', { 'class': 'a207u-mlabel', text: cell.label }));
    } else if (cell.kind === 'pair') {
      td.className = 'a207u-pair a207u-cell a207u-col-att';
      a.appendChild(el('span', { 'class': 'a207u-maru', text: '〇' }));
    } else if (cell.kind === 'marks') {
      td.className = 'a207u-cell a207u-col-att';
      var box = el('span', { 'class': 'a207u-marks' });
      box.appendChild(markLine('案', cell.an));
      box.appendChild(markLine('サ', cell.sign));
      a.appendChild(box);
    } else { // none
      td.className = 'a207u-cell a207u-col-att';
      a.appendChild(el('span', { 'class': 'a207u-mark-x', text: '×' }));
    }
    td.appendChild(a);
    return td;
  }

  function markLine(label, count) {
    var line = el('span');
    line.appendChild(el('span', { 'class': 'a207u-mlbl', text: label }));
    var mark = (count === 0) ? '×' : (count === 1 ? '〇' : String(count));
    line.appendChild(el('span', {
      'class': count === 0 ? 'a207u-mark-x' : null,
      text: mark
    }));
    return line;
  }

  /* ---------------- ローディング・エラー ---------------- */

  function renderLoading(root) {
    clearEl(root);
    var box = el('div', { 'class': 'a207u-loading' });
    box.appendChild(el('div', { 'class': 'a207u-spin' }));
    var txt = el('div', { text: 'レコード読込中…' });
    box.appendChild(txt);
    root.appendChild(box);
    return {
      set: function (n207, n10) {
        txt.textContent = 'レコード読込中…（支援計画 ' + n207 + '件 / 児童氏名マスタ ' + n10 + '件）';
      }
    };
  }

  function renderFatal(root, lines, retryFn) {
    clearEl(root);
    var box = el('div', { 'class': 'a207u-fatal' });
    box.appendChild(el('div', {
      text: '「更新月一覧」を表示できません。フィールド設定を確認してください。\n'
    }));
    lines.forEach(function (l) { box.appendChild(el('div', { text: '・' + l })); });
    var btn = el('button', { 'class': 'a207u-btn', type: 'button', text: '再試行', style: 'margin-top:10px;' });
    btn.addEventListener('click', retryFn);
    box.appendChild(btn);
    root.appendChild(box);
  }

  function renderError(root, message, retryFn) {
    clearEl(root);
    var box = el('div', { 'class': 'a207u-fatal' });
    box.appendChild(el('div', { text: 'データの取得に失敗しました。\n' + (message || '') }));
    var btn = el('button', { 'class': 'a207u-btn', type: 'button', text: '再試行', style: 'margin-top:10px;' });
    btn.addEventListener('click', retryFn);
    box.appendChild(btn);
    root.appendChild(box);
  }

  /* =====================================================================
   * Block 4/4  状態保存・イベント・エントリポイント
   * ===================================================================== */

  function saveState() {
    try {
      var data = {
        riyousaki: state.riyousaki,
        scrollLeft: ui.tableWrap ? ui.tableWrap.scrollLeft : 0,
        scrollY: window.pageYOffset || 0
      };
      sessionStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* sessionStorage不可環境では無視 */ }
  }

  function loadSavedState() {
    try {
      var raw = sessionStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function applyInitialState() {
    // 復元: 利用先スイッチ＋スクロールのみ（設計図§9）
    var saved = loadSavedState();
    if (saved && (RIYOUSAKI_TABS.indexOf(saved.riyousaki) >= 0 || saved.riyousaki === RIYOUSAKI_BOTH)) {
      state.riyousaki = saved.riyousaki;
    } else {
      state.riyousaki = RIYOUSAKI_TABS[0];
    }
    state.savedScroll = saved ? { left: saved.scrollLeft || 0, y: saved.scrollY || 0 } : null;
    // 表示月・担当・検索は毎回初期化（常に今月から開始）
    state.windowStart = todayIdx();
    state.search = '';
    state.initialTantoApplied = false;
  }

  function restoreScroll() {
    if (!state.savedScroll) return;
    var sc = state.savedScroll;
    state.savedScroll = null;
    window.requestAnimationFrame(function () {
      if (ui.tableWrap) ui.tableWrap.scrollLeft = sc.left;
      window.scrollTo(0, sc.y);
    });
  }

  function loadData(isReload) {
    var root = document.getElementById(CONFIG.ROOT_ID);
    if (!root) return;

    // 再読込時は現在の選択状態（ウィンドウ・担当・検索・利用先）を維持
    var keep = null;
    if (isReload && state.model) {
      saveState();
      keep = {
        windowStart: state.windowStart,
        tanto: state.tanto,
        search: state.search,
        riyousaki: state.riyousaki,
        scrollLeft: ui.tableWrap ? ui.tableWrap.scrollLeft : 0,
        scrollY: window.pageYOffset || 0
      };
    }

    var progress = renderLoading(root);
    var n207 = 0, n10 = 0;
    var F = CONFIG.FIELDS;
    var fields207 = Object.keys(F).map(function (k) { return F[k]; });
    var fields10 = [
      CONFIG.CROSS.CHILD.NAME, CONFIG.CROSS.CHILD.BIRTH,
      CONFIG.CROSS.CHILD.CONTRACT, CONFIG.CROSS.CHILD.STATUS
    ];

    validateForm(state.appId)
      .then(function () {
        return Promise.all([
          fetchAllFrom(state.appId, fields207, function (n) { n207 = n; progress.set(n207, n10); }),
          fetchAllFrom(CONFIG.CROSS.CHILD.APP_ID, fields10, function (n) { n10 = n; progress.set(n207, n10); })
        ]);
      })
      .then(function (res) {
        state.model = buildModel(res[0], res[1]);
        state.searchRows = buildSearchRows(state.model);

        if (keep) {
          state.windowStart = keep.windowStart;
          state.tanto = keep.tanto;
          state.search = keep.search;
          state.riyousaki = keep.riyousaki;
          state.initialTantoApplied = true;
          state.savedScroll = { left: keep.scrollLeft, y: keep.scrollY };
        }

        renderShell(root);
        if (keep && state.search) ui.searchInput.value = state.search;
        recomputeWindowRows();
        updateNav();
        updateTantoOptions();
        updateSwitch();
        updateSecondaryBtn();
        updateWarnings();
        updateSearchUI();
        updateTable();
        restoreScroll();
      })
      .catch(function (err) {
        if (err && err.a207uFatal) {
          renderFatal(root, err.a207uFatal, function () { loadData(isReload); });
        } else {
          var msg = (err && (err.message || err.code)) ? (err.message || err.code) : String(err);
          renderError(root, msg, function () { loadData(isReload); });
        }
      });
  }

  function boot() {
    var root = document.getElementById(CONFIG.ROOT_ID);
    if (!root) return;
    injectStyle();
    state.appId = kintone.app.getId();
    try {
      var u = kintone.getLoginUser();
      state.loginName = (u && u.name) ? String(u.name).trim() : '';
    } catch (e) { state.loginName = ''; }
    applyInitialState();
    loadData(false);
  }

  /* ---------------- kintoneイベント（他コードと共存） ---------------- */
  if (typeof kintone !== 'undefined' && kintone.events && kintone.events.on) {
    kintone.events.on('app.record.index.show', function (event) {
      if (event.viewName !== CONFIG.VIEW_NAME) return event;
      var root = document.getElementById(CONFIG.ROOT_ID);
      if (!root) return event;
      if (root.dataset.a207uBound === '1') return event;
      root.dataset.a207uBound = '1';
      boot();
      return event;
    });
  }

  /* ---------------- Node.js テスト用エクスポート ---------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CONFIG: CONFIG,
      ATT_KEYS: ATT_KEYS,
      RIYOUSAKI_TABS: RIYOUSAKI_TABS,
      RIYOUSAKI_BOTH: RIYOUSAKI_BOTH,
      RIYOUSAKI_HIDDEN: RIYOUSAKI_HIDDEN,
      STATUS_ACTIVE: STATUS_ACTIVE,
      STATUS_KNOWN: STATUS_KNOWN,
      WINDOW_BEFORE: WINDOW_BEFORE,
      WINDOW_AFTER: WINDOW_AFTER,
      WINDOW_LEN: WINDOW_LEN,
      STEP_SMALL: STEP_SMALL,
      STEP_LARGE: STEP_LARGE,
      TANTO_ALL: TANTO_ALL,
      TANTO_NONE: TANTO_NONE,
      GRADE_MASTER: GRADE_MASTER,
      GRADE_SECONDARY_START: GRADE_SECONDARY_START,
      parseDate: parseDate,
      monthIdx: monthIdx,
      idxToYM: idxToYM,
      offsetInPlanYear: offsetInPlanYear,
      planYearOf: planYearOf,
      periodOf: periodOf,
      fiscalYearOfIdx: fiscalYearOfIdx,
      isNewEnrollment: isNewEnrollment,
      computeGrade: computeGrade,
      normalizeKana: normalizeKana,
      matchesSearch: matchesSearch,
      jaCompare: jaCompare,
      classifyRecord: classifyRecord,
      classifyRiyousaki: classifyRiyousaki,
      mergeGroup: mergeGroup,
      buildModel: buildModel,
      resolveMergeLevel: resolveMergeLevel,
      expandWindowRows: expandWindowRows,
      buildSearchRows: buildSearchRows,
      buildTantoOptions: buildTantoOptions,
      resolveInitialTanto: resolveInitialTanto,
      isWarningVisibleForWindow: isWarningVisibleForWindow,
      riyousakiPass: riyousakiPass,
      tantoPass: tantoPass
    };
  }
})();
