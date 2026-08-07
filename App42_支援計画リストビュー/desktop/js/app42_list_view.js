/**
 * =====================================================================
 * アプリ42「支援計画」一覧カスタマイズ（マトリクス表示ビュー）
 * ---------------------------------------------------------------------
 * ファイル : app42_list_view.js（PC用JavaScript）
 * 対象     : kintone アプリ42 / カスタマイズビュー「支援計画一覧」
 * 依存     : なし（vanilla JS・外部ライブラリ不使用・ビルド不要）
 * 認証     : kintone.api() のセッション認証のみ（APIトークン不使用）
 *            ※アプリ146・147へのクロスアプリ参照読取のため、実行ユーザーが
 *              両アプリの閲覧権限を持っている必要があります。
 * ---------------------------------------------------------------------
 * 改修履歴
 *  2026-07-15 (1) : 訪問担当プルダウンをヘッダー行の年度の右隣へ移動
 *  2026-07-15 (2) : 園/学校列を廃止し、2行目の園/学校サブタブへ変更
 *  2026-07-15 (3) : 今回改修（本ファイル）
 *    a. 警告バッジ・パネルを選択年度のレコードに紐づく警告のみに絞り込み
 *       （種別ドロップダウン・利用状況の選択肢差分など年度に紐付かない
 *        フィールド定義系の通知のみ例外として常時表示。理由は§末尾参照）
 *       全ての年度紐付き警告に「居住地」「園/学校名」を表示
 *    b. 同姓同名疑いの理由を「居住地が一致しません」「ふりがなが一致しません」
 *       のように端的に表示。また「同一スロット×同一種別の重複登録」は
 *       別人疑いの根拠から除外し、該当レコードの添付件数を合算して
 *       1つのセルとして扱う（複数レコードの合算で〇になれば〇表示）
 *    c. 園/学校サブタブを2段に分割（上段=園、下段=学校）。各段に
 *       「すべて」「未設定」を個別に用意。もう一方の段の選択で
 *       クロスフィルタされた人数をバッジ表示
 *    d. 市町村タブ・園/学校サブタブの人数バッジを「訪問担当フィルタ適用後」
 *       の人数に変更
 *    e. 年度プルダウンの右に児童検索ボックスを追加（児童氏名=漢字部分一致 /
 *       ふりがな=ひらがな・カタカナを正規化して部分一致）。検索中は
 *       市町村タブ・園/学校サブタブ・訪問担当フィルタを一時的に無効化し、
 *       選択年度の全児童を横断して検索する
 *    f. 担当別タブを廃止し、代わりに全市町村統合の「すべて」タブを
 *       タブバー最左に追加（年度を問わず常時表示）
 *    g. 市町村タブの判定基準を「契約」（居住地）から、児童が実際に通う
 *       施設（学校/園）のエリアへ変更。アプリ146（学校一覧）・
 *       アプリ147（園一覧）の「エリア」フィールドをクロスアプリ参照し、
 *       施設名からエリアを引く。施設名がアプリ146/147に見つからない
 *       場合は「契約」（居住地）へフォールバックし、警告パネルに
 *       「施設が登録されていません」として通知する
 *  2026-07-15 (4) : 前回改修に対する確認回答を反映
 *    a. 「種別」ドロップダウンの未対応選択肢を常時表示していた「plan_extra」
 *       通知を廃止。実際にその値を使うレコードがあれば、短期開始日から
 *       年度が特定できる「分類不能(unclassified)」として自動検知されるため
 *       （年度紐付きの仕組みに一本化）
 *    b. 「利用状況」選択肢差分（status_diff）は、非該当ステータスが
 *       今年度一覧から単純に非表示になるだけで実害がないため、
 *       従来通り年度を問わない常時表示のまま据え置き
 *    c. 「すべて」タブは元々選択中の年度でgetRoster()する設計のため、
 *       年度単位で絞り込まれる仕様は変更前から満たしている（コード変更なし。
 *       念のため本コメントで明記）
 *  2026-07-15 (5) : 今回改修（本ファイル）
 *    a. 園/学校2段サブタブの「未設定」集計に学年ゲートを追加。園段の未設定は
 *       未就学児のみ、学校段の未設定は就学児（小1以上）のみを対象にする
 *       （学年的に空欄が当然なケースを「未設定」として計上・絞り込み対象にしない）
 *    b. 園/学校2段サブタブを複数選択（チップ）方式に変更。各段の先頭に「すべて」
 *       ボタンを設置（もう一度押すと全解除できるトグル。null=全選択↔{}=全解除）。
 *       単一の「すべて」タブは廃止。選択状態はチップの色のみで示し、
 *       チェックボックス記号は使用しない
 *    c. 児童氏名をアプリ10（児童氏名マスタ・ルックアップ参照元）のレコード詳細へ
 *       リンク。一致するレコードが見つからない場合は「△」注記＋警告パネル通知、
 *       同姓同名で複数該当する場合も警告パネルで通知した上で最新レコードへリンク
 *    d. 警告パネルから「短期開始日が空」「児童氏名が空」の通知を除外（レコード
 *       作成直後など通常運用でも頻発するため）。レコード自体を一覧から除外する
 *       判定ロジックは従来どおり維持（年度・期・児童を特定できないレコードを
 *       表示しないため）
 *  2026-07-15 (6) : 今回改修（本ファイル）
 *    a. 市町村タブの初期配置を必ず「すべて」にするよう修正。以前は
 *       sessionStorageに保存された前回選択タブを復元していたため、過去に
 *       特定の市町村タブを選んだままにしていると次回もそのタブで開いてしまう
 *       不具合があった（年度・訪問担当・段選択・スクロール位置の復元は維持）
 *    b. 園/学校の「すべて」トグルを、色だけでなくスイッチのノブ位置が
 *       左右に動く見た目に変更し、オン/オフをより直感的に分かるようにした
 * ---------------------------------------------------------------------
 * 構成（4ブロック）
 *   Block 1/4 : CONFIG・定数・ユーティリティ
 *   Block 2/4 : 起動時検証・全件取得（クロスアプリ含む）・データモデル構築
 *   Block 3/4 : 描画（ヘッダー/検索/タブ/サブタブ2段/テーブル/セル/警告）
 *   Block 4/4 : 状態保存復元・イベント配線・エントリポイント
 * =====================================================================
 */
(function () {
  'use strict';

  // ================================================================
  // Block 1/4 : CONFIG・定数・ユーティリティ
  // ================================================================

  /** 設定はここに集約（設計書 §12.1・今回改修分を追加） */
  var CONFIG = {
    VIEW_NAME: '支援計画一覧',   // 実際に作成するカスタマイズビュー名と完全一致させる
    VIEW_ID: null,               // 一覧IDで判定したい場合のみ数値を設定（通常はnullのままでビュー名判定）
    FIELDS: {
      CHILD_NAME:         '児童氏名',
      FURIGANA:           'ふりがな',
      BIRTHDAY:           '生年月日',
      PLAN_TYPE:          '種別',        // ドロップダウン
      SHORT_START:        '短期開始日',
      CONTRACT:           '契約',
      EN:                 '園',
      GAKKO:              '学校',
      STATUS:             '利用状況',
      TANTO:              '訪問担当',
      ATT_AN:             '案',
      ATT_KEIKAKU:        '計画',        // 添付ファイル（種別とは別コード）
      ATT_ASSESS_AN:      'アセス案',
      ATT_ASSESS_KEIKAKU: 'アセス計画',
      ATT_SHOMEI:         '署名',
      ATT_SHOMEI2:        '署名2'
    },
    STATUS_ACTIVE: '利用中',
    STATUS_KNOWN: ['利用中', '待機中', '検討中', '終結'],
    MUNI_FIXED: ['玉城町', '度会町', '明和町', '多気町', '大台町', '伊勢市', '松阪市'],
    // PLAN の各ラベルは起動時にフォーム設定から自動抽出した選択肢と突合される
    PLAN: {
      ZK_R: '訪問（前期立案）',
      ZK_H: '訪問（前期評価）',
      KK_R: '訪問（後期立案）',
      KK_H: '訪問（後期評価）',
      AS_R: 'アセス計画',
      AS_H: 'アセス評価',
      END:  '終結評価'
    },
    // クロスアプリ参照: アプリ146=学校一覧 / アプリ147=園一覧 / アプリ10=児童氏名（ルックアップ参照元）
    CROSS_APPS: {
      SCHOOL: { APP_ID: 146, NAME: '学校名', AREA: 'エリア' },
      EN:     { APP_ID: 147, NAME: '園名',   AREA: 'エリア' },
      CHILD:  { APP_ID: 10,  NAME: '児童氏名' }
    }
  };

  /** フィールドタイプの期待値（起動時検証用） */
  var FIELD_TYPE_EXPECT = {
    CHILD_NAME:         ['SINGLE_LINE_TEXT'],
    FURIGANA:           ['SINGLE_LINE_TEXT'],
    BIRTHDAY:           ['DATE'],
    PLAN_TYPE:          ['DROP_DOWN'],
    SHORT_START:        ['DATE'],
    CONTRACT:           ['SINGLE_LINE_TEXT', 'DROP_DOWN'],
    EN:                 ['SINGLE_LINE_TEXT', 'DROP_DOWN'],
    GAKKO:              ['SINGLE_LINE_TEXT', 'DROP_DOWN'],
    STATUS:             ['DROP_DOWN', 'RADIO_BUTTON', 'SINGLE_LINE_TEXT'],
    TANTO:              ['SINGLE_LINE_TEXT', 'DROP_DOWN'],
    ATT_AN:             ['FILE'],
    ATT_KEIKAKU:        ['FILE'],
    ATT_ASSESS_AN:      ['FILE'],
    ATT_ASSESS_KEIKAKU: ['FILE'],
    ATT_SHOMEI:         ['FILE'],
    ATT_SHOMEI2:        ['FILE']
  };

  /** スロット定義（表示順）とラベル */
  var SLOT_IDS = ['zk_r', 'zk_h', 'kk_r', 'kk_h'];
  var SLOT_LABELS = { zk_r: '前期立案', zk_h: '前期評価', kk_r: '後期立案', kk_h: '後期評価' };

  /** タブ・フィルタの特殊キー */
  var TAB_UNSET = '#unset';   // 実効エリア（施設エリア or 契約）が空の児童
  var TAB_ALL = '#all';       // 全市町村統合タブ（旧・担当別タブを置き換え。最左固定）
  var TANTO_ALL = '#all';     // 全担当
  var TANTO_NONE = '#none';   // （担当未設定）

  /** 園/学校サブタブの特殊キー */
  var FAC_UNSET = '#facunset'; // 未設定（当該フィールドが空。学年適用対象者のみ集計）

  var STORAGE_KEY = 'app42MatrixState';

  /** 実行時状態 */
  var state = {
    appId: null,
    currentFY: null,
    model: null,
    validation: null,
    fy: null,
    tabKey: null,
    // 園/学校サブタブの選択状態（複数選択・チェックボックス方式）。
    // null = 「すべて選択」状態（フィルタなし）。オブジェクト{value:true,...} = 個別選択中。
    facEnSelected: null,
    facGakkoSelected: null,
    enTabsCache: [],       // 直近描画した園段タブ一覧（トグル時に「全選択→個別解除」へ変換する材料）
    gakkoTabsCache: [],    // 直近描画した学校段タブ一覧
    tanto: TANTO_ALL,
    searchText: '',         // 児童検索ボックスの入力値
    savedScroll: null,
    els: {}
  };

  // ---------------- ユーティリティ ----------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clearEl(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** レコードのフィールド値を安全に文字列で取得 */
  function getStr(rec, code) {
    var f = rec[code];
    if (!f || f.value === undefined || f.value === null) return '';
    var v = f.value;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      return v.map(function (x) {
        return (x && (x.name || x.code)) ? (x.name || x.code) : String(x);
      }).join(', ');
    }
    if (typeof v === 'object') return v.name || v.code || '';
    return String(v);
  }

  /** 添付ファイルフィールドの件数（メタ情報配列の長さのみ利用） */
  function fileCount(rec, code) {
    var f = rec[code];
    return (f && Array.isArray(f.value)) ? f.value.length : 0;
  }

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** 'YYYY-MM-DD' を解析し、整数値・年度・期を返す（不正ならnull） */
  function parseDate(s) {
    var m = DATE_RE.exec(s || '');
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return {
      y: y, mo: mo, d: d,
      int: y * 10000 + mo * 100 + d,
      fy: (mo >= 4) ? y : y - 1,
      period: (mo >= 4 && mo <= 9) ? 'zk' : 'kk'
    };
  }

  /** 本日基準の今年度 */
  function computeCurrentFY(now) {
    var d = now || new Date();
    var m = d.getMonth() + 1;
    return (m >= 4) ? d.getFullYear() : d.getFullYear() - 1;
  }

  function jaCompare(a, b) {
    return String(a).localeCompare(String(b), 'ja');
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }

  /** 任意アプリのレコード詳細URL（別タブで開く用） */
  function crossRecordUrl(appId, recordId) {
    return location.origin + '/k/' + appId + '/show#record=' + recordId;
  }

  /** アプリ42自身のレコード詳細URL */
  function recordUrl(id) {
    return crossRecordUrl(state.appId, id);
  }

  /**
   * カタカナ→ひらがな正規化（児童検索用。2026-07-15改修 e）。
   * 全角カタカナ（U+30A1〜U+30F6）をひらがな範囲へ-0x60シフトするのみで、
   * ひらがな・漢字はそのまま通す。これにより「ひらがな入力」「カタカナ入力」
   * のどちらでも同じ正規化結果になり、ふりがなとの比較を一本化できる。
   */
  function normalizeKana(s) {
    return String(s || '').replace(/[\u30a1-\u30f6]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }

  /** 児童検索の一致判定（漢字=氏名部分一致 / ひらがな・カタカナ=ふりがな部分一致。§e） */
  function matchesSearch(e, queryNorm) {
    if (!queryNorm) return true;
    if (e.rep.name && e.rep.name.indexOf(queryNorm) !== -1) return true;
    if (e.rep.furigana && normalizeKana(e.rep.furigana).indexOf(queryNorm) !== -1) return true;
    return false;
  }

  // ---------------- 学年算出 ----------------

  /** 学年マスタ。schoolAge=null は生年月日空（学年不明・最下部） */
  function gradeMaster(schoolAge) {
    function g(order, label, isPreschool, category) {
      return { order: order, label: label, isPreschool: isPreschool, category: category, facilityFallback: false };
    }
    if (schoolAge === null) {
      return { order: 999, label: '学年不明', isPreschool: false, category: 'unknown', facilityFallback: true };
    }
    var a = (schoolAge < 0) ? 0 : schoolAge;
    if (a === 0) return g(0, '０歳児', true, 'pre');
    if (a === 1) return g(1, '１歳児', true, 'pre');
    if (a === 2) return g(2, '２歳児', true, 'pre');
    if (a === 3) return g(3, '３歳(年少)', true, 'pre');
    if (a === 4) return g(4, '４歳(年中)', true, 'pre');
    if (a === 5) return g(5, '５歳(年長)', true, 'pre');
    if (a <= 11) return g(a, '小' + (a - 5), false, 'elem');
    if (a <= 14) return g(a, '中' + (a - 11), false, 'jhs');
    if (a <= 17) return g(a, '高' + (a - 14), false, 'hs');
    return g(18, '18歳以上', false, 'hs');
  }

  /** 生年月日 + 選択年度 → 学年 */
  function computeGrade(birthday, fy) {
    var bd = parseDate(birthday);
    if (!bd) return gradeMaster(null);
    var schoolAge = Math.floor((fy * 10000 + 401 - bd.int) / 10000);
    return gradeMaster(schoolAge);
  }

  // ================================================================
  // Block 2/4 : 起動時検証・全件取得（クロスアプリ含む）・データモデル構築
  // ================================================================

  /** DROP_DOWN等のoptionsを画面上の並び順（index順）でラベル配列化 */
  function sortOptionLabels(options) {
    return Object.keys(options || {})
      .map(function (k) { return options[k]; })
      .sort(function (a, b) { return Number(a.index) - Number(b.index); })
      .map(function (o) { return o.label; });
  }

  /** 単一アプリのフォームフィールド定義を取得する薄いラッパー */
  function fetchFormFields(appId) {
    return kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: appId });
  }

  /**
   * 起動時自動検証
   *  - アプリ42: CONFIG.FIELDS 全コードの存在・タイプ照合（不一致は致命的エラー）
   *  - アプリ42「種別」選択肢を自動抽出しCONFIG.PLANの7値と自動突合（不足は致命的エラー）
   *  - アプリ42「利用状況」選択肢とCONFIG.STATUS_KNOWNの参考照合（不一致は警告のみ）
   *  - アプリ146・147（学校/園一覧）: NAME・AREAフィールドの存在・タイプ照合
   *  - アプリ10（児童氏名マスタ・ルックアップ参照元）: NAMEフィールドの存在・タイプ照合
   *    （いずれも不一致は致命的エラー）
   * @return Promise<{fatal: string[], notices: object[]}>
   */
  function validateForm() {
    return Promise.all([
      fetchFormFields(state.appId),
      fetchFormFields(CONFIG.CROSS_APPS.SCHOOL.APP_ID),
      fetchFormFields(CONFIG.CROSS_APPS.EN.APP_ID),
      fetchFormFields(CONFIG.CROSS_APPS.CHILD.APP_ID)
    ]).then(function (results) {
      var props = results[0].properties || {};
      var schoolProps = results[1].properties || {};
      var enProps = results[2].properties || {};
      var childProps = results[3].properties || {};
      var fatal = [];
      var notices = [];

      Object.keys(CONFIG.FIELDS).forEach(function (key) {
        var code = CONFIG.FIELDS[key];
        var expect = FIELD_TYPE_EXPECT[key] || [];
        var f = props[code];
        if (!f) {
          fatal.push('アプリ42: フィールドコード「' + code + '」（CONFIG.FIELDS.' + key + '）が存在しません。期待タイプ: ' + expect.join(' または '));
          return;
        }
        if (expect.length && expect.indexOf(f.type) === -1) {
          fatal.push('アプリ42: フィールド「' + code + '」のタイプが不一致です。期待: ' + expect.join(' または ') + ' / 実際: ' + f.type);
        }
      });

      function checkCrossApp(label, appProps, appId, nameCode, areaCode) {
        var nf = appProps[nameCode];
        if (!nf) {
          fatal.push(label + '（アプリ' + appId + '）: フィールドコード「' + nameCode + '」が存在しません。');
        } else if (nf.type !== 'SINGLE_LINE_TEXT') {
          fatal.push(label + '（アプリ' + appId + '）: フィールド「' + nameCode + '」のタイプが不一致です。期待: SINGLE_LINE_TEXT / 実際: ' + nf.type);
        }
        if (!areaCode) return;
        var af = appProps[areaCode];
        if (!af) {
          fatal.push(label + '（アプリ' + appId + '）: フィールドコード「' + areaCode + '」が存在しません。');
        } else if (af.type !== 'DROP_DOWN') {
          fatal.push(label + '（アプリ' + appId + '）: フィールド「' + areaCode + '」のタイプが不一致です。期待: DROP_DOWN / 実際: ' + af.type);
        }
      }
      checkCrossApp('学校一覧', schoolProps, CONFIG.CROSS_APPS.SCHOOL.APP_ID, CONFIG.CROSS_APPS.SCHOOL.NAME, CONFIG.CROSS_APPS.SCHOOL.AREA);
      checkCrossApp('園一覧',   enProps,     CONFIG.CROSS_APPS.EN.APP_ID,     CONFIG.CROSS_APPS.EN.NAME,     CONFIG.CROSS_APPS.EN.AREA);
      checkCrossApp('児童氏名マスタ', childProps, CONFIG.CROSS_APPS.CHILD.APP_ID, CONFIG.CROSS_APPS.CHILD.NAME, null);

      // 「種別」選択肢の自動抽出・自動突合
      // 2026-07-15追加改修: 以前はCONFIG.PLAN未対応の選択肢を「plan_extra」として
      // 年度に関わらず常時表示していたが、実際にその値を使うレコードがあれば
      // isKnownPlan()判定により自動的に「分類不能（unclassified）」として検知され、
      // 短期開始日から年度も特定されるため重複していた。未使用の選択肢を
      // 先回りして常時警告する意義は薄いため、この事前チェックは廃止し、
      // 年度紐付きのunclassified検知に一本化する（fatalチェックは維持）。
      var planField = props[CONFIG.FIELDS.PLAN_TYPE];
      if (planField && planField.type === 'DROP_DOWN') {
        var actual = sortOptionLabels(planField.options);
        var expected = Object.keys(CONFIG.PLAN).map(function (k) { return CONFIG.PLAN[k]; });
        var missing = expected.filter(function (v) { return actual.indexOf(v) === -1; });
        if (missing.length) {
          fatal.push('アプリ42:「' + CONFIG.FIELDS.PLAN_TYPE + '」の選択肢に次の値が見つかりません（表記ゆれの可能性）: ' + missing.join(' ／ '));
          fatal.push('アプリ42:「' + CONFIG.FIELDS.PLAN_TYPE + '」の実際の選択肢一覧: ' + actual.join(' ／ '));
        }
      }

      // 「利用状況」の参考照合（status_diff）は年度に紐付けない仕様のまま維持する。
      // 利用中以外は今年度一覧から単純に非表示になるだけで実害がないため（据え置き確認済み）。

      // 「利用状況」選択肢の参考照合（不一致でも致命的エラーにしない）
      var statusField = props[CONFIG.FIELDS.STATUS];
      if (statusField && (statusField.type === 'DROP_DOWN' || statusField.type === 'RADIO_BUTTON')) {
        var actualS = sortOptionLabels(statusField.options);
        var missingS = CONFIG.STATUS_KNOWN.filter(function (v) { return actualS.indexOf(v) === -1; });
        var extraS = actualS.filter(function (v) { return CONFIG.STATUS_KNOWN.indexOf(v) === -1; });
        if (missingS.length || extraS.length) notices.push({ type: 'status_diff', missing: missingS, extra: extraS });
      }

      return { fatal: fatal, notices: notices };
    });
  }

  /** 汎用: シーク法による全件取得（複数アプリで共用） */
  function fetchAllFrom(appId, fields, onProgress) {
    var out = [];
    function page(lastId) {
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: appId,
        query: '$id > ' + lastId + ' order by $id asc limit 500',
        fields: fields
      }).then(function (resp) {
        var recs = resp.records || [];
        for (var i = 0; i < recs.length; i++) out.push(recs[i]);
        if (onProgress) onProgress(out.length);
        if (recs.length < 500) return out;
        return page(recs[recs.length - 1].$id.value);
      });
    }
    return page(0);
  }

  /** アプリ42の全件取得 */
  function fetchAllRecords(onProgress) {
    var fields = ['$id'];
    Object.keys(CONFIG.FIELDS).forEach(function (k) { fields.push(CONFIG.FIELDS[k]); });
    return fetchAllFrom(state.appId, fields, onProgress);
  }

  /** アプリ146/147の全件取得 → { 施設名: エリア } のマップを作る */
  function fetchAreaMap(cfg, onProgress) {
    return fetchAllFrom(cfg.APP_ID, ['$id', cfg.NAME, cfg.AREA], onProgress).then(function (recs) {
      var map = {};
      recs.forEach(function (r) {
        var name = getStr(r, cfg.NAME).trim();
        var area = getStr(r, cfg.AREA).trim();
        if (name && area) map[name] = area;
      });
      return map;
    });
  }

  /**
   * アプリ10（児童氏名マスタ・ルックアップ参照元）の全件取得 →
   * { 児童氏名: { id: 代表レコードID, ambiguous: bool, allIds: [...] } } のマップを作る。
   * 同姓同名で複数レコードが存在する場合は$id最大を代表として採用しつつambiguous:trueを立てる
   * （警告パネルで通知するため）。
   */
  function fetchChildMap(onProgress) {
    return fetchAllFrom(CONFIG.CROSS_APPS.CHILD.APP_ID, ['$id', CONFIG.CROSS_APPS.CHILD.NAME], onProgress).then(function (recs) {
      var byName = {};
      recs.forEach(function (r) {
        var name = getStr(r, CONFIG.CROSS_APPS.CHILD.NAME).trim();
        if (!name) return;
        var id = Number(r.$id.value);
        if (!byName[name]) byName[name] = [];
        byName[name].push(id);
      });
      var map = {};
      Object.keys(byName).forEach(function (name) {
        var ids = byName[name].sort(function (a, b) { return a - b; });
        map[name] = { id: ids[ids.length - 1], ambiguous: ids.length >= 2, allIds: ids };
      });
      return map;
    });
  }

  // ---------------- 分類ロジック ----------------

  /** 種別ラベル → スロット/種類/添付セット。未知の値はnull */
  function classify(planLabel, period) {
    var P = CONFIG.PLAN;
    if (planLabel === P.ZK_R) return { slot: 'zk_r', kind: 'visit', attach: 'plain' };
    if (planLabel === P.ZK_H) return { slot: 'zk_h', kind: 'visit', attach: 'plain' };
    if (planLabel === P.KK_R) return { slot: 'kk_r', kind: 'visit', attach: 'plain' };
    if (planLabel === P.KK_H) return { slot: 'kk_h', kind: 'visit', attach: 'plain' };
    if (planLabel === P.AS_R) return { slot: (period === 'zk') ? 'zk_r' : 'kk_r', kind: 'assess', attach: 'assess' };
    if (planLabel === P.AS_H) return { slot: (period === 'zk') ? 'zk_h' : 'kk_h', kind: 'assess', attach: 'assess' };
    if (planLabel === P.END)  return { slot: (period === 'zk') ? 'zk_h' : 'kk_h', kind: 'end',    attach: 'plain' };
    return null;
  }

  function isKnownPlan(label) {
    return Object.keys(CONFIG.PLAN).some(function (k) { return CONFIG.PLAN[k] === label; });
  }

  /** 添付3種（案・計・署）の件数。種類により対象フィールドを切替 */
  function countsFor(rec, attach) {
    if (attach === 'assess') {
      return {
        an:      fileCount(rec, CONFIG.FIELDS.ATT_ASSESS_AN),
        keikaku: fileCount(rec, CONFIG.FIELDS.ATT_ASSESS_KEIKAKU),
        shomei:  fileCount(rec, CONFIG.FIELDS.ATT_SHOMEI2)
      };
    }
    return {
      an:      fileCount(rec, CONFIG.FIELDS.ATT_AN),
      keikaku: fileCount(rec, CONFIG.FIELDS.ATT_KEIKAKU),
      shomei:  fileCount(rec, CONFIG.FIELDS.ATT_SHOMEI)
    };
  }

  /**
   * 同一スロット内で「種別（planType）が完全一致」する候補同士を合算する（2026-07-15改修 b）。
   * 例: 「訪問（前期立案）」が誤って2レコード登録された場合、案・計・署の件数を合算し、
   * 1つのセルとして扱う（合算した結果が1件以上あれば〇、2件以上なら件数表示）。
   * これは「別人疑い」の根拠から除外する（買い物リストのような単純な二重登録のため）。
   * kind・attachはplanTypeが同じであれば必ず同じなので、合算後も一意に決まる。
   */
  function mergeSameTypeCandidates(cands) {
    var byType = {};
    var order = [];
    cands.forEach(function (c) {
      if (!byType[c.planType]) { byType[c.planType] = []; order.push(c.planType); }
      byType[c.planType].push(c);
    });
    return order.map(function (pt) {
      var grp = byType[pt];
      if (grp.length === 1) return grp[0];
      var maxId = grp.reduce(function (m, g) { return (g.recordId > m) ? g.recordId : m; }, -1);
      var files = { an: 0, keikaku: 0, shomei: 0 };
      grp.forEach(function (g) {
        files.an += g.files.an;
        files.keikaku += g.files.keikaku;
        files.shomei += g.files.shomei;
      });
      return {
        recordId: maxId, kind: grp[0].kind, planType: pt, files: files,
        merged: true,
        mergedIds: grp.map(function (g) { return g.recordId; }).sort(function (a, b) { return a - b; })
      };
    });
  }

  /**
   * スロット衝突の解決（種別が異なるもの同士が同じスロットを取り合う場合のみ発生）。
   * 評価スロットに終結評価が含まれる場合は終結評価を優先、それ以外は$id最大を採用。
   */
  function resolveConflict(cands) {
    var ends = cands.filter(function (c) { return c.kind === 'end'; });
    var pool = ends.length ? ends : cands;
    return pool.reduce(function (a, b) { return (b.recordId > a.recordId) ? b : a; });
  }

  /**
   * 児童の学年区分に応じた「認定される園/学校名」を1つ返す（学年不明時は値のある方・学校優先）。
   * ※注記・施設エリア照合（市町村タブ判定）の両方でこの1本化された値を用いる。
   * 2段の園/学校サブタブ（2026-07-15改修 c）は、これとは別に「園」「学校」の生値をそのまま使う。
   */
  function facilityInfo(e) {
    if (e.grade.facilityFallback) {
      if (e.rep.gakko) return { name: e.rep.gakko, source: 'gakko' };
      if (e.rep.en) return { name: e.rep.en, source: 'en' };
      return { name: '', source: '' };
    }
    if (e.grade.isPreschool) return { name: e.rep.en || '', source: 'en' };
    return { name: e.rep.gakko || '', source: 'gakko' };
  }

  /** 学年区分の主フィールドが空で他方に値がある場合の注記文言（該当なしはnull） */
  function facilityNoteInfo(e) {
    if (e.grade.facilityFallback) return null;
    if (e.grade.isPreschool) {
      if (!e.rep.en && e.rep.gakko) return '学年区分に対応するデータ未入力（「園」が空。「学校」には値あり: ' + e.rep.gakko + '）';
    } else {
      if (!e.rep.gakko && e.rep.en) return '学年区分に対応するデータ未入力（「学校」が空。「園」には値あり: ' + e.rep.en + '）';
    }
    return null;
  }

  /**
   * 施設名からエリアを引く（2026-07-15改修 g）。
   * facilityInfo()で決まる「認定施設名」を、その施設のsource（園/学校）に応じた
   * マスタ（enAreaMap/schoolAreaMap）で引き、エリア文字列を返す。
   * 施設名が空 → area:null, unregistered:false（引く対象がない。契約へフォールバック）
   * 施設名はあるがマスタに未登録 → area:null, unregistered:true（警告対象）
   */
  function facilityAreaOf(e, schoolAreaMap, enAreaMap) {
    var info = facilityInfo(e);
    if (!info.name) return { area: null, unregistered: false, name: '' };
    var map = (info.source === 'en') ? enAreaMap : schoolAreaMap;
    var area = map[info.name];
    if (area) return { area: area, unregistered: false, name: info.name };
    return { area: null, unregistered: true, name: info.name };
  }

  /**
   * 園/学校サブタブの「未設定」集計に学年ゲートをかけるための判定（今回改修）。
   * 園段の「未設定」は未就学児のみを対象にする（小学生以上が園フィールド空なのは
   * 当然なので、それを「未設定」として計上・フィルタ対象にしない）。
   * 学校段の「未設定」は就学児（小1以上）のみを対象にする（未就学児が学校フィールド
   * 空なのは当然なので同様に対象外とする）。学年不明（生年月日なし）はどちらの
   * 判定にも該当しないため、どちらの段の絞り込みも素通りする（判断材料がないまま
   * 誤って除外しないための安全側の裁量判断）。
   */
  function isPreschoolApplicable(e) { return e.grade.isPreschool === true; }
  function isSchoolApplicable(e) { return !e.grade.facilityFallback && e.grade.isPreschool === false; }
  function facRowApplicable(e, field) {
    return (field === 'en') ? isPreschoolApplicable(e) : isSchoolApplicable(e);
  }

  /**
   * データモデル構築。
   * @param records        アプリ42の全レコード
   * @param currentFY      本日基準の今年度
   * @param schoolAreaMap  { 学校名: エリア } アプリ146由来
   * @param enAreaMap      { 園名: エリア } アプリ147由来
   * @param childMap       { 児童氏名: {id, ambiguous, allIds} } アプリ10由来（ルックアップ参照元）
   */
  function buildModel(records, currentFY, schoolAreaMap, enAreaMap, childMap) {
    var model = { fyList: [], byFY: {}, warnings: [] };
    var dup = {};             // fy -> key -> { contracts:{}, furis:{} }
    var extraMuniByFy = {};   // fy -> { 契約値: true }（※契約フィールド自体の入力チェック用。タブ判定には使わない）

    records.forEach(function (rec) {
      var id = Number(rec.$id.value);
      var name = getStr(rec, CONFIG.FIELDS.CHILD_NAME).trim();
      var planType = getStr(rec, CONFIG.FIELDS.PLAN_TYPE).trim();
      var shortStartRaw = getStr(rec, CONFIG.FIELDS.SHORT_START).trim();
      var dt = parseDate(shortStartRaw);
      var contractRaw = getStr(rec, CONFIG.FIELDS.CONTRACT).trim();
      var enRaw = getStr(rec, CONFIG.FIELDS.EN).trim();
      var gakkoRaw = getStr(rec, CONFIG.FIELDS.GAKKO).trim();

      // 「短期開始日が空」「児童氏名が空」は、まだ入力途中の通常運用（レコード作成直後等）
      // として頻繁に起こりうるため、警告としては表示しない。ただし年度・期・児童の
      // 特定ができないことに変わりはないため、レコードの除外（一覧非表示）自体は維持する。
      var reasons = [];
      if (shortStartRaw && !dt) reasons.push('短期開始日が不正（' + shortStartRaw + '）');
      if (!planType) reasons.push('種別が空');
      else if (!isKnownPlan(planType)) reasons.push('種別が未知の値（' + planType + '）');

      var mustExclude = !name || !dt || !planType || !isKnownPlan(planType);
      if (mustExclude) {
        if (reasons.length) {
          model.warnings.push({
            type: 'unclassified', fy: dt ? dt.fy : null, recordId: id,
            name: name || '（氏名なし）', contract: contractRaw || '（空）',
            facility: (enRaw || gakkoRaw) || '（空）', detail: reasons.join(' / ')
          });
        }
        // reasons.length===0は「児童氏名が空」「短期開始日が空」のみが原因のケース
        // （警告なしで静かに除外）
        return;
      }

      var cls = classify(planType, dt.period);
      var birthday = getStr(rec, CONFIG.FIELDS.BIRTHDAY).trim();
      var bd = parseDate(birthday);
      var key = name + '_' + (bd ? String(bd.int) : 'nobd');
      var fy = dt.fy;

      if (!model.byFY[fy]) model.byFY[fy] = {};
      var e = model.byFY[fy][key];
      if (!e) {
        e = {
          key: key, rep: null, repId: -1, allIds: [],
          duplicateNameReasons: [], grade: null, areaInfo: null, effectiveArea: '',
          cands: { zk_r: [], zk_h: [], kk_r: [], kk_h: [] },
          slots: { zk_r: null, zk_h: null, kk_r: null, kk_h: null }
        };
        model.byFY[fy][key] = e;
      }
      e.allIds.push(id);
      e.cands[cls.slot].push({ recordId: id, kind: cls.kind, planType: planType, files: countsFor(rec, cls.attach) });

      if (id > e.repId) {
        e.repId = id;
        e.rep = {
          name: name,
          furigana: getStr(rec, CONFIG.FIELDS.FURIGANA).trim(),
          birthday: birthday,
          contract: contractRaw,
          en: enRaw,
          gakko: gakkoRaw,
          tanto: getStr(rec, CONFIG.FIELDS.TANTO).trim(),
          status: getStr(rec, CONFIG.FIELDS.STATUS).trim()
        };
      }

      if (!dup[fy]) dup[fy] = {};
      if (!dup[fy][key]) dup[fy][key] = { contracts: {}, furis: {} };
      var t = dup[fy][key];
      if (contractRaw) t.contracts[contractRaw] = true;
      var furi = getStr(rec, CONFIG.FIELDS.FURIGANA).trim();
      if (furi) t.furis[furi] = true;

      if (contractRaw && CONFIG.MUNI_FIXED.indexOf(contractRaw) === -1) {
        if (!extraMuniByFy[fy]) extraMuniByFy[fy] = {};
        extraMuniByFy[fy][contractRaw] = true;
      }
    });

    // 確定処理（スロット合算・衝突解決・別人疑い判定・学年算出・エリア判定）
    Object.keys(model.byFY).forEach(function (fyStr) {
      var fy = Number(fyStr);
      var map = model.byFY[fy];
      Object.keys(map).forEach(function (key) {
        var e = map[key];

        // 学年（先に算出しておく。facilityInfo()がe.grade.facilityFallbackを参照するため、
        // 以下のスロット処理・別人疑い判定より前に確定させる必要がある。
        // ※2026-07-15リリース後に発生した実障害の修正: 以前はこの算出をSLOT_IDS.forEachの
        //   後段に置いていたため、衝突警告・別人疑い警告の生成時点でe.gradeがnullのままとなり
        //   facilityInfo(e)内のe.grade.facilityFallback参照がTypeErrorで例外を起こしていた）
        e.grade = computeGrade(e.rep.birthday, fy);

        SLOT_IDS.forEach(function (sid) {
          var merged = mergeSameTypeCandidates(e.cands[sid]);
          if (merged.length === 0) { e.slots[sid] = null; return; }
          if (merged.length === 1) {
            var c = merged[0];
            e.slots[sid] = {
              recordId: c.recordId, kind: c.kind, files: c.files, conflict: false,
              merged: !!c.merged, mergedIds: c.mergedIds
            };
            return;
          }
          var chosen = resolveConflict(merged);
          e.slots[sid] = {
            recordId: chosen.recordId, kind: chosen.kind, files: chosen.files, conflict: true,
            merged: !!chosen.merged, mergedIds: chosen.mergedIds
          };
          model.warnings.push({
            type: 'conflict', fy: fy, name: e.rep.name,
            contract: e.rep.contract || '（空）',
            facility: facilityInfo(e).name || '（空）',
            slot: sid,
            recordIds: merged.map(function (m) { return m.recordId; }).sort(function (a, b) { return a - b; }),
            chosenId: chosen.recordId
          });
        });

        // 同姓同名+同一生年月日の疑い（理由を端的に列挙。
        // 「同一スロット×同一種別の重複」は上のmergeで吸収済みのため判定対象から除外）
        var t = dup[fy][key];
        var reasons2 = [];
        if (Object.keys(t.contracts).length >= 2) reasons2.push('居住地（契約）が一致しません');
        if (Object.keys(t.furis).length >= 2) reasons2.push('ふりがなが一致しません');
        e.duplicateNameReasons = reasons2;
        if (reasons2.length) {
          model.warnings.push({
            type: 'dupname', fy: fy, name: e.rep.name,
            birthday: e.rep.birthday || '（生年月日なし）',
            contract: e.rep.contract || '（空）',
            facility: facilityInfo(e).name || '（空）',
            reasons: reasons2,
            recordIds: e.allIds.slice().sort(function (a, b) { return a - b; })
          });
        }

        // 施設エリア判定（市町村タブの判定基盤）
        var areaInfo = facilityAreaOf(e, schoolAreaMap, enAreaMap);
        e.areaInfo = areaInfo;
        e.effectiveArea = areaInfo.area || e.rep.contract || '';
        if (areaInfo.unregistered) {
          model.warnings.push({
            type: 'facility_unregistered', fy: fy, name: e.rep.name,
            contract: e.rep.contract || '（空）',
            facility: areaInfo.name,
            recordIds: e.allIds.slice().sort(function (a, b) { return a - b; })
          });
        }

        // 今年度なのに利用状況が既知4値以外/空 → 参考警告
        if (fy === currentFY && CONFIG.STATUS_KNOWN.indexOf(e.rep.status) === -1) {
          model.warnings.push({
            type: 'status_hidden', fy: fy, name: e.rep.name,
            contract: e.rep.contract || '（空）',
            facility: facilityInfo(e).name || '（空）',
            status: e.rep.status || '（空）',
            recordIds: e.allIds.slice().sort(function (a, b) { return a - b; })
          });
        }

        // アプリ10（児童氏名マスタ・ルックアップ参照元）とのリンク解決
        var childInfo = childMap ? childMap[e.rep.name] : null;
        if (childInfo) {
          e.app10Id = childInfo.id;
          if (childInfo.ambiguous) {
            model.warnings.push({
              type: 'app10_ambiguous', fy: fy, name: e.rep.name,
              contract: e.rep.contract || '（空）',
              facility: facilityInfo(e).name || '（空）',
              allIds: childInfo.allIds
            });
          }
        } else {
          e.app10Id = null;
          model.warnings.push({
            type: 'app10_missing', fy: fy, name: e.rep.name,
            contract: e.rep.contract || '（空）',
            facility: facilityInfo(e).name || '（空）',
            recordIds: e.allIds.slice().sort(function (a, b) { return a - b; })
          });
        }

        delete e.cands;
      });
    });

    // 「契約」フィールド自体の入力チェック（固定7町以外の値。年度紐付き）
    Object.keys(extraMuniByFy).forEach(function (fyStr) {
      var fy = Number(fyStr);
      var values = Object.keys(extraMuniByFy[fy]).sort(jaCompare);
      if (values.length) model.warnings.push({ type: 'extramuni', fy: fy, values: values });
    });

    var fySet = {};
    Object.keys(model.byFY).forEach(function (f) { fySet[f] = true; });
    fySet[currentFY] = true;
    model.fyList = Object.keys(fySet).map(Number).sort(function (a, b) { return b - a; });

    return model;
  }

  // ---------------- 表示対象・並び順 ----------------

  /** 選択年度の表示対象児童（ソート済み）。今年度のみ利用状況=利用中で絞る */
  function getRoster(model, fy, currentFY) {
    var map = model.byFY[fy] || {};
    var isCur = (fy === currentFY);
    var list = [];
    Object.keys(map).forEach(function (key) {
      var e = map[key];
      if (isCur && e.rep.status !== CONFIG.STATUS_ACTIVE) return;
      list.push(e);
    });
    list.sort(childCompare);
    return list;
  }

  function childCompare(a, b) {
    if (a.grade.order !== b.grade.order) return a.grade.order - b.grade.order;
    var fa = a.rep.furigana;
    var fb = b.rep.furigana;
    if (fa && fb) {
      var c = jaCompare(fa, fb);
      if (c !== 0) return c;
    } else if (fa) {
      return -1;
    } else if (fb) {
      return 1;
    }
    var n = jaCompare(a.rep.name, b.rep.name);
    if (n !== 0) return n;
    return (a.key < b.key) ? -1 : (a.key > b.key) ? 1 : 0;
  }

  /**
   * 市町村タブ（またはTAB_ALL/TAB_UNSET）で絞り込んだ児童。
   * 2026-07-15改修 g: 判定基準は「契約」ではなく「実効エリア」（施設エリア優先・
   * 未登録/未入力時は契約へフォールバック）
   */
  function rosterForTab(model, fy, currentFY, tabKey) {
    var rows = getRoster(model, fy, currentFY);
    if (tabKey === TAB_ALL) return rows;
    return rows.filter(function (e) {
      return (tabKey === TAB_UNSET) ? !e.effectiveArea : (e.effectiveArea === tabKey);
    });
  }

  // ---------------- タブ・担当フィルタ構築 ----------------

  /**
   * 市町村タブ一覧。
   * 「すべて」（旧・担当別タブを置き換え。年度を問わず常時表示）を最左固定 →
   * 固定7町（0人でも常設）→ 追加エリア（五十音順）→ 未設定。
   * 2026-07-15改修 d: countは「訪問担当フィルタ適用後」の人数。
   */
  function buildTabList(model, fy, currentFY, effTanto) {
    var full = getRoster(model, fy, currentFY);
    var rows = (effTanto === TANTO_ALL) ? full : full.filter(function (e) {
      return (effTanto === TANTO_NONE) ? !e.rep.tanto : (e.rep.tanto === effTanto);
    });
    var counts = {};
    var unsetCount = 0;
    var extras = {};
    rows.forEach(function (e) {
      var a = e.effectiveArea;
      if (!a) { unsetCount++; return; }
      counts[a] = (counts[a] || 0) + 1;
      if (CONFIG.MUNI_FIXED.indexOf(a) === -1) extras[a] = true;
    });
    var tabs = [{ key: TAB_ALL, label: 'すべて', count: rows.length }];
    CONFIG.MUNI_FIXED.forEach(function (m) {
      tabs.push({ key: m, label: m, count: counts[m] || 0 });
    });
    Object.keys(extras).sort(jaCompare).forEach(function (m) {
      tabs.push({ key: m, label: m, count: counts[m] || 0, extra: true });
    });
    if (unsetCount > 0) tabs.push({ key: TAB_UNSET, label: '未設定', count: unsetCount });
    return tabs;
  }

  /**
   * 保存タブの構造的妥当性チェック（全担当基準。人数バッジの多寡に関わらず
   * タブ自体の存在有無のみを見るため、判定にはTANTO_ALLでのタブ一覧を用いる）
   */
  function normalizeTabKey(model, fy, currentFY, tabKey) {
    var tabs = buildTabList(model, fy, currentFY, TANTO_ALL);
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].key === tabKey) return tabKey;
    }
    return TAB_ALL;
  }

  /** 共通担当フィルタの選択肢（選択年度の表示対象児童から動的列挙・五十音順） */
  function buildTantoOptions(model, fy, currentFY) {
    var roster = getRoster(model, fy, currentFY);
    var set = {};
    var hasNone = false;
    roster.forEach(function (e) {
      if (e.rep.tanto) set[e.rep.tanto] = true;
      else hasNone = true;
    });
    var opts = [{ value: TANTO_ALL, label: '全担当' }];
    Object.keys(set).sort(jaCompare).forEach(function (n) {
      opts.push({ value: n, label: n });
    });
    if (hasNone) opts.push({ value: TANTO_NONE, label: '（担当未設定）' });
    return opts;
  }

  // ---------------- 園/学校2段サブタブ（複数選択方式） ----------------

  /**
   * 児童eが、指定フィールド('en'=園 or 'gakko'=学校)の段フィルタを通過するか判定する。
   *  - facRowApplicable(e,field)がfalse（学年的にその段の対象外＝未就学児にとっての「学校」段、
   *    就学児にとっての「園」段、または生年月日なしで判定不能）の場合は、その段のフィルタ内容に
   *    関わらず常に通過させる（そもそもその段の分類対象ではない児童のため）。
   *  - selectedRaw が null の場合は「すべて選択」状態を意味し、対象者は常に通過する。
   *  - selectedRaw がオブジェクトの場合、値が空なら「未設定」キーの選択有無、
   *    値があればその値がキーとして選択されているかどうかで判定する。
   */
  function passesFacRowFilter(e, field, selectedRaw) {
    if (!facRowApplicable(e, field)) return true;
    if (selectedRaw === null) return true;
    var v = e.rep[field];
    if (!v) return !!selectedRaw[FAC_UNSET];
    return !!selectedRaw[v];
  }

  /**
   * 指定フィールド('en'=園 or 'gakko'=学校)の生値でタブ一覧を作る（「すべて」は含まない。
   * 「すべて選択」はUI上のボタン操作として別途扱う）。
   * 「未設定」は、その段に学年的に該当する児童（facRowApplicable）に限って集計する
   * （園段の未設定に小学生を含めない・学校段の未設定に未就学児を含めない）。
   * rowsは「もう一方の段の現在の選択で絞り込み済み」の集合を渡すことで、
   * 段同士のクロスフィルタ人数（バッジ）を実現する。
   */
  function buildFacRowTabs(rows, field) {
    var counts = {};
    rows.forEach(function (e) {
      var v = e.rep[field];
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
    var unsetCount = rows.filter(function (e) { return facRowApplicable(e, field) && !e.rep[field]; }).length;
    var tabs = [];
    Object.keys(counts).sort(jaCompare).forEach(function (v) {
      tabs.push({ key: v, label: v, count: counts[v] });
    });
    if (unsetCount > 0) tabs.push({ key: FAC_UNSET, label: '未設定', count: unsetCount });
    return tabs;
  }

  // ================================================================
  // Block 3/4 : 描画
  // ================================================================

  // ---------------- ローディング / エラー表示 ----------------

  function renderLoading(root, text) {
    clearEl(root);
    var box = el('div', 'a42m-loading');
    box.appendChild(el('div', 'a42m-spinner'));
    var t = el('div', 'a42m-loadingtext', text || '読込中…');
    box.appendChild(t);
    root.appendChild(box);
    state.els.loadingText = t;
  }

  function updateLoadingText(text) {
    if (state.els.loadingText) state.els.loadingText.textContent = text;
  }

  function renderFatal(root, messages) {
    clearEl(root);
    var box = el('div', 'a42m-fatal');
    box.appendChild(el('div', 'a42m-fataltitle', 'フィールド定義の検証エラー（テーブル描画を中断しました）'));
    var ul = el('ul', 'a42m-fatallist');
    messages.forEach(function (m) { ul.appendChild(el('li', null, m)); });
    box.appendChild(ul);
    box.appendChild(el('div', 'a42m-fatalnote', 'app42_list_view.js 冒頭の CONFIG と、kintoneのフォーム設定（アプリ42・146・147）を照合してください。修正後に「再試行」を押すと再検証します。'));
    var retry = el('button', 'a42m-retry', '再試行');
    retry.type = 'button';
    retry.addEventListener('click', function () { loadEverything(root); });
    box.appendChild(retry);
    root.appendChild(box);
  }

  function renderError(root, err) {
    clearEl(root);
    var box = el('div', 'a42m-fatal');
    box.appendChild(el('div', 'a42m-fataltitle', 'データ取得に失敗しました'));
    var msg = '';
    if (err) msg = err.message || (err.errors ? JSON.stringify(err.errors) : String(err));
    box.appendChild(el('div', 'a42m-fatalnote', msg || '不明なエラー'));
    box.appendChild(el('div', 'a42m-fatalnote', '不完全な状態では表を表示しません。通信状態・アクセス権（アプリ146・147の閲覧権限含む）を確認のうえ再試行してください。'));
    var retry = el('button', 'a42m-retry', '再試行');
    retry.type = 'button';
    retry.addEventListener('click', function () { loadEverything(root); });
    box.appendChild(retry);
    root.appendChild(box);
  }

  // ---------------- 骨格 ----------------
  //
  //  [年度▼] [検索____×] [訪問担当▼] [再読込]                   [⚠n]
  //  [すべて(30)] [玉城町(12)] ... [松阪市(3)] [未設定(1)]       ← 1行目: 市町村タブ
  //  ((玉城町 ▸ 園: [すべて(8)][A保育園(4)][未設定(2)]))          ← 2行目上段: 園
  //  ((        ▸ 学校:[すべて(8)][B小学校(6)][未設定(1)]))        ← 2行目下段: 学校
  //  [テーブル]
  //
  function renderShell(root) {
    clearEl(root);
    var wrap = el('div', 'a42m-wrap');

    var header = el('div', 'a42m-header');

    var fyLabel = el('label', 'a42m-ctllabel', '年度');
    var fySelect = document.createElement('select');
    fySelect.className = 'a42m-fyselect';
    fyLabel.appendChild(fySelect);
    header.appendChild(fyLabel);

    // 児童検索ボックス（年度の右隣。2026-07-15改修 e）
    var searchWrap = el('div', 'a42m-searchwrap');
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'a42m-searchinput';
    searchInput.placeholder = '児童検索（氏名・ふりがな）';
    searchWrap.appendChild(searchInput);
    var searchClear = el('button', 'a42m-searchclear', '✕');
    searchClear.type = 'button';
    searchClear.style.display = 'none';
    searchWrap.appendChild(searchClear);
    header.appendChild(searchWrap);

    var tantoLabel = el('label', 'a42m-ctllabel', '訪問担当');
    var tantoSelect = document.createElement('select');
    tantoSelect.className = 'a42m-tantoselect';
    tantoLabel.appendChild(tantoSelect);
    header.appendChild(tantoLabel);

    var reloadBtn = el('button', 'a42m-reload', '再読込');
    reloadBtn.type = 'button';
    header.appendChild(reloadBtn);

    header.appendChild(el('div', 'a42m-spacer'));

    var warnBtn = el('button', 'a42m-warnbtn', '');
    warnBtn.type = 'button';
    warnBtn.style.display = 'none';
    header.appendChild(warnBtn);
    wrap.appendChild(header);

    var warnPanel = el('div', 'a42m-warnpanel');
    warnPanel.style.display = 'none';
    wrap.appendChild(warnPanel);

    // 検索中の注記（市町村タブ・サブタブ・担当フィルタを一時無効化している旨）
    var searchNote = el('div', 'a42m-searchnote', '検索結果を選択年度の全児童（市町村・園/学校・訪問担当を問わず）から表示しています');
    searchNote.style.display = 'none';
    wrap.appendChild(searchNote);

    // 1行目: 市町村タブバー
    var tabbar = el('div', 'a42m-tabs');
    wrap.appendChild(tabbar);

    // 2行目: 園/学校2段サブタブ
    var subtabsWrap = el('div', 'a42m-subtabswrap');
    var enRow = el('div', 'a42m-subtabrow');
    var gakkoRow = el('div', 'a42m-subtabrow');
    subtabsWrap.appendChild(enRow);
    subtabsWrap.appendChild(gakkoRow);
    wrap.appendChild(subtabsWrap);

    var tableWrap = el('div', 'a42m-tablewrap');
    wrap.appendChild(tableWrap);

    root.appendChild(wrap);

    state.els = {
      root: root, wrap: wrap,
      fySelect: fySelect, searchInput: searchInput, searchClear: searchClear, searchNote: searchNote,
      reloadBtn: reloadBtn, warnBtn: warnBtn, warnPanel: warnPanel,
      tabbar: tabbar, subtabsWrap: subtabsWrap, enRow: enRow, gakkoRow: gakkoRow,
      tantoSelect: tantoSelect, tableWrap: tableWrap, loadingText: null
    };

    fySelect.addEventListener('change', onFYChange);
    searchInput.addEventListener('input', debounce(onSearchInput, 200));
    searchClear.addEventListener('click', onSearchClear);
    tantoSelect.addEventListener('change', onTantoChange);
    tabbar.addEventListener('click', onTabClick);
    enRow.addEventListener('click', function (ev) { onFacRowToggle(ev, 'en'); });
    gakkoRow.addEventListener('click', function (ev) { onFacRowToggle(ev, 'gakko'); });
    reloadBtn.addEventListener('click', onReload);
    warnBtn.addEventListener('click', onWarnToggle);
    tableWrap.addEventListener('scroll', debounce(saveState, 300));
  }

  // ---------------- 共通算出ヘルパー ----------------

  function isCurrentFY() { return state.fy === state.currentFY; }

  function effTanto() { return isCurrentFY() ? state.tanto : TANTO_ALL; }

  function isSearching() { return normalizeKana(state.searchText.trim()) !== ''; }

  /** 市町村/未設定タブ + 訪問担当フィルタまで適用した基準ロースター（検索モード時は使わない） */
  function baseRosterForCity() {
    var rows = rosterForTab(state.model, state.fy, state.currentFY, state.tabKey);
    var et = effTanto();
    if (et !== TANTO_ALL) {
      rows = rows.filter(function (e) {
        return (et === TANTO_NONE) ? !e.rep.tanto : (e.rep.tanto === et);
      });
    }
    return rows;
  }

  // ---------------- 各パーツ描画 ----------------

  function renderFYOptions() {
    var sel = state.els.fySelect;
    clearEl(sel);
    state.model.fyList.forEach(function (fy) {
      var op = document.createElement('option');
      op.value = String(fy);
      op.textContent = fy + '年度';
      sel.appendChild(op);
    });
    sel.value = String(state.fy);
  }

  function renderSearchUI() {
    var searching = isSearching();
    state.els.searchClear.style.display = searching ? '' : 'none';
    state.els.searchNote.style.display = searching ? '' : 'none';
    state.els.wrap.classList.toggle('a42m-searching', searching);
  }

  /** 1行目: 市町村タブバー（人数バッジは訪問担当フィルタ適用後） */
  function renderTabs() {
    var bar = state.els.tabbar;
    clearEl(bar);
    var tabs = buildTabList(state.model, state.fy, state.currentFY, effTanto());
    tabs.forEach(function (t) {
      var b = el('button', 'a42m-tab' + (t.key === state.tabKey ? ' a42m-tab-active' : ''), t.label + ' (' + t.count + ')');
      b.type = 'button';
      b.dataset.key = t.key;
      bar.appendChild(b);
    });
    var active = bar.querySelector('.a42m-tab-active');
    if (active && active.scrollIntoView) {
      try { active.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* no-op */ }
    }
  }

  /**
   * 2行目: 園/学校2段サブタブ（複数選択方式）。
   * 上段（園）の人数バッジは「下段（学校）の現在の選択」で絞り込んだ集合から算出し、
   * 下段（学校）の人数バッジは「上段（園）の現在の選択」で絞り込んだ集合から算出する
   * （段同士のクロスフィルタ表示）。「すべて」タブは廃止し、各段の先頭に
   * 「すべて」ボタン（もう一度押すと全解除できるトグル。null=全選択 / {}=全解除）を置く。
   */
  function renderFacTabs() {
    var cityRows = baseRosterForCity();
    var rowsForEnCounts = cityRows.filter(function (e) { return passesFacRowFilter(e, 'gakko', state.facGakkoSelected); });
    var rowsForGakkoCounts = cityRows.filter(function (e) { return passesFacRowFilter(e, 'en', state.facEnSelected); });
    var enTabs = buildFacRowTabs(rowsForEnCounts, 'en');
    var gakkoTabs = buildFacRowTabs(rowsForGakkoCounts, 'gakko');
    state.enTabsCache = enTabs;
    state.gakkoTabsCache = gakkoTabs;

    function renderRow(container, label, tabs, selectedRaw) {
      clearEl(container);
      container.appendChild(el('span', 'a42m-subtabs-label', label));

      var isAllOn = (selectedRaw === null);
      var switchWrap = el('div', 'a42m-allswitch-wrap');
      switchWrap.appendChild(el('span', 'a42m-allswitch-label', 'すべて'));
      var switchBtn = el('button', 'a42m-allswitch' + (isAllOn ? ' a42m-allswitch-on' : ''), '');
      switchBtn.type = 'button';
      switchBtn.dataset.allbtn = '1';
      switchBtn.setAttribute('role', 'switch');
      switchBtn.setAttribute('aria-checked', isAllOn ? 'true' : 'false');
      switchBtn.title = isAllOn ? 'すべて選択中（クリックで全解除）' : 'すべて解除中（クリックで全選択）';
      switchWrap.appendChild(switchBtn);
      container.appendChild(switchWrap);

      var bar = el('div', 'a42m-subtabs');
      tabs.forEach(function (t) {
        var isActive = (selectedRaw === null) || !!selectedRaw[t.key];
        var b = el('button', 'a42m-subtab' + (isActive ? ' a42m-subtab-active' : ''), t.label + ' (' + t.count + ')');
        b.type = 'button';
        b.dataset.fkey = t.key;
        bar.appendChild(b);
      });
      container.appendChild(bar);
    }
    renderRow(state.els.enRow, '園', enTabs, state.facEnSelected);
    renderRow(state.els.gakkoRow, '学校', gakkoTabs, state.facGakkoSelected);
  }

  function renderTantoFilter() {
    var sel = state.els.tantoSelect;
    var isCur = isCurrentFY();
    clearEl(sel);
    if (!isCur) {
      var opAll = document.createElement('option');
      opAll.value = TANTO_ALL;
      opAll.textContent = '全担当';
      sel.appendChild(opAll);
      sel.value = TANTO_ALL;
      sel.disabled = true;
      return;
    }
    var opts = buildTantoOptions(state.model, state.fy, state.currentFY);
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      sel.appendChild(op);
    });
    var exists = opts.some(function (o) { return o.value === state.tanto; });
    if (!exists) state.tanto = TANTO_ALL;
    sel.value = state.tanto;
    sel.disabled = false;
  }

  /** テーブル本体。検索中は市町村/園学校/担当の各フィルタを無視し選択年度の全児童から検索 */
  function renderTable() {
    var wrapEl = state.els.tableWrap;
    clearEl(wrapEl);
    var isCur = isCurrentFY();
    var searching = isSearching();
    var byAll = (state.tabKey === TAB_ALL);

    var rows;
    if (searching) {
      var q = normalizeKana(state.searchText.trim());
      rows = getRoster(state.model, state.fy, state.currentFY).filter(function (e) { return matchesSearch(e, q); });
    } else {
      rows = baseRosterForCity();
      rows = rows.filter(function (e) { return passesFacRowFilter(e, 'en', state.facEnSelected); });
      rows = rows.filter(function (e) { return passesFacRowFilter(e, 'gakko', state.facGakkoSelected); });
    }

    if (rows.length === 0) {
      wrapEl.appendChild(el('div', 'a42m-emptymsg', '該当なし'));
      return;
    }

    function th(text, cls) { return el('th', cls, text); }

    // 契約列は「すべてタブ」または検索モード（市町村を横断するため）で表示
    var showContract = byAll || searching;
    var table = el('table', 'a42m-table' + (showContract ? ' a42m-table-wide' : ''));
    var colCount = (showContract ? 1 : 0) + 1 + (isCur ? 1 : 0) + SLOT_IDS.length;

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    if (showContract) htr.appendChild(th('契約', 'a42m-col-contract'));
    htr.appendChild(th('児童氏名', 'a42m-col-name a42m-sticky-name'));
    if (isCur) htr.appendChild(th('訪問担当', 'a42m-col-tanto'));
    SLOT_IDS.forEach(function (sid) { htr.appendChild(th(SLOT_LABELS[sid], 'a42m-col-slot')); });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var lastOrder = null;
    rows.forEach(function (e) {
      if (e.grade.order !== lastOrder) {
        lastOrder = e.grade.order;
        var gtr = el('tr', 'a42m-graderow');
        var gtd = el('td', 'a42m-gradecell a42m-grade-' + e.grade.category);
        gtd.colSpan = colCount;
        gtd.appendChild(el('span', 'a42m-gradelabel', e.grade.label));
        gtr.appendChild(gtd);
        tbody.appendChild(gtr);
      }
      tbody.appendChild(renderChildRow(e, { showContract: showContract, isCur: isCur }));
    });
    table.appendChild(tbody);
    wrapEl.appendChild(table);
  }

  function renderChildRow(e, opt) {
    var tr = el('tr', 'a42m-row');

    if (opt.showContract) {
      tr.appendChild(el('td', 'a42m-td a42m-col-contract', e.rep.contract || ''));
    }

    var nameTd = el('td', 'a42m-td a42m-col-name a42m-sticky-name');
    if (e.app10Id) {
      var nameLink = document.createElement('a');
      nameLink.className = 'a42m-name a42m-namelink';
      nameLink.href = crossRecordUrl(CONFIG.CROSS_APPS.CHILD.APP_ID, e.app10Id);
      nameLink.target = '_blank';
      nameLink.rel = 'noopener';
      nameLink.textContent = e.rep.name;
      nameLink.title = 'アプリ10（児童氏名マスタ）のレコードを開く';
      nameTd.appendChild(nameLink);
    } else {
      nameTd.appendChild(el('span', 'a42m-name', e.rep.name));
      var nf = el('span', 'a42m-namenotfound', '△');
      nf.title = 'アプリ10（児童氏名マスタ）に一致するレコードが見つかりません（警告パネル参照）';
      nameTd.appendChild(nf);
    }
    if (e.duplicateNameReasons.length) {
      var w = el('span', 'a42m-dupwarn', '⚠');
      w.title = '同姓同名の可能性: ' + e.duplicateNameReasons.join(' / ') + '（警告パネル参照）';
      nameTd.appendChild(w);
    }
    var noteText = facilityNoteInfo(e);
    if (noteText) {
      var n = el('span', 'a42m-facnote', '※');
      n.title = noteText;
      nameTd.appendChild(n);
    }
    tr.appendChild(nameTd);

    if (opt.isCur) {
      tr.appendChild(el('td', 'a42m-td a42m-col-tanto', e.rep.tanto || ''));
    }

    SLOT_IDS.forEach(function (sid) {
      tr.appendChild(renderCell(e.slots[sid]));
    });
    return tr;
  }

  function renderCell(slot) {
    if (!slot) {
      return el('td', 'a42m-td a42m-cell a42m-cell-none', '×');
    }

    var td = el('td', 'a42m-td a42m-cell');
    var a = document.createElement('a');
    a.className = 'a42m-celllink';
    a.href = recordUrl(slot.recordId);
    a.target = '_blank';
    a.rel = 'noopener';

    if (slot.kind !== 'visit' || slot.conflict || slot.merged) {
      var badges = el('div', 'a42m-badges');
      if (slot.kind === 'assess') badges.appendChild(el('span', 'a42m-badge a42m-badge-assess', 'アセス'));
      if (slot.kind === 'end') badges.appendChild(el('span', 'a42m-badge a42m-badge-end', '終結'));
      if (slot.conflict) {
        var c = el('span', 'a42m-conflict', '⚠');
        c.title = 'スロット衝突（種別の異なる複数レコードが該当。警告パネル参照）';
        badges.appendChild(c);
      }
      if (slot.merged) {
        var mg = el('span', 'a42m-merged', '🔗');
        mg.title = '同一種別の重複レコードを合算表示（No.' + slot.mergedIds.join(', No.') + '）';
        badges.appendChild(mg);
      }
      a.appendChild(badges);
    }

    function markGroup(label, count) {
      var g = el('span', 'a42m-mark');
      g.appendChild(el('span', 'a42m-marklabel', label));
      var sym, cls;
      if (count === 0) { sym = '×'; cls = 'a42m-ng'; }
      else if (count === 1) { sym = '〇'; cls = 'a42m-ok'; }
      else { sym = String(count); cls = 'a42m-multi'; }
      g.appendChild(el('span', 'a42m-marksym ' + cls, sym));
      return g;
    }
    var marks = el('div', 'a42m-marks');
    var an = slot.files.an, kk = slot.files.keikaku, sh = slot.files.shomei;
    if (an >= 1 && kk >= 1 && sh >= 1) {
      marks.appendChild(el('span', 'a42m-marksym a42m-allok', '〇'));
    } else if (an === 0 && kk === 0 && sh === 0) {
      marks.appendChild(el('span', 'a42m-marksym a42m-allng', '×'));
    } else {
      marks.appendChild(markGroup('案', an));
      marks.appendChild(markGroup('計', kk));
      marks.appendChild(markGroup('署', sh));
    }
    a.appendChild(marks);

    td.appendChild(a);
    return td;
  }

  // ---------------- 警告・診断パネル ----------------

  /**
   * 年度に紐づけて表示できる警告は選択中年度のもののみに絞る。
   * 「利用状況」選択肢差分（status_diff）は特定のレコード・年度に属さない
   * フィールド定義自体の通知であり、かつ非該当ステータスは今年度一覧から
   * 単純に非表示になるだけで実害がないため、年度を問わず常時表示する
   * （2026-07-15追加確認済み）。一方「種別」の未対応選択肢は、実際に使われた
   * 場合は短期開始日から年度が特定できる分類不能(unclassified)として
   * 検知されるため、別枠の常時表示は行わない（plan_extra通知は廃止）。
   * unclassifiedのうち短期開始日が不正で年度を特定できないものも、
   * 年度によらず常時表示する。
   */
  function isWarningVisibleForYear(w, fy) {
    if (w.type === 'status_diff') return true;
    if (w.fy === null || w.fy === undefined) return true;
    return w.fy === fy;
  }

  function collectWarnings() {
    var list = (state.model ? state.model.warnings.slice() : []);
    var notices = (state.validation && state.validation.notices) || [];
    notices.forEach(function (n) { list.push(n); });
    return list.filter(function (w) { return isWarningVisibleForYear(w, state.fy); });
  }

  function renderWarnings() {
    var all = collectWarnings();
    var btn = state.els.warnBtn;
    if (all.length === 0) {
      btn.style.display = 'none';
      state.els.warnPanel.style.display = 'none';
      return;
    }
    btn.style.display = '';
    btn.textContent = '⚠ ' + all.length;
    renderWarnPanelBody(all);
  }

  function renderWarnPanelBody(all) {
    var panel = state.els.warnPanel;
    clearEl(panel);

    var head = el('div', 'a42m-warnhead');
    head.appendChild(el('span', 'a42m-warntitle', state.fy + '年度の警告・診断（' + all.length + '件）'));
    var close = el('button', 'a42m-warnclose', '✕');
    close.type = 'button';
    close.addEventListener('click', function () { panel.style.display = 'none'; });
    head.appendChild(close);
    panel.appendChild(head);

    function byType(t) { return function (w) { return w.type === t; }; }
    function recLink(id, appId) {
      var a = document.createElement('a');
      a.href = appId ? crossRecordUrl(appId, id) : recordUrl(id);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'No.' + id;
      a.className = 'a42m-reclink';
      return a;
    }
    function appendRecLinks(li, ids, appId) {
      ids.forEach(function (id, i) {
        if (i > 0) li.appendChild(document.createTextNode(', '));
        li.appendChild(recLink(id, appId));
      });
    }
    /** 居住地・園/学校名を共通フォーマットで付記（2026-07-15改修 a） */
    function locSuffix(w) {
      return '［居住地: ' + (w.contract || '（空）') + ' / 園・学校: ' + (w.facility || '（空）') + '］';
    }
    function section(title, items, fill) {
      if (!items.length) return;
      panel.appendChild(el('div', 'a42m-warnsec', title + '（' + items.length + '）'));
      var ul = el('ul', 'a42m-warnlist');
      items.forEach(function (w) {
        var li = document.createElement('li');
        fill(w, li);
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    }

    section('分類不能レコード（一覧に表示されません）', all.filter(byType('unclassified')), function (w, li) {
      li.appendChild(recLink(w.recordId));
      li.appendChild(document.createTextNode(' ' + w.name + '： ' + w.detail + ' ' + locSuffix(w)));
    });

    section('スロット衝突（種別の異なるレコード同士）', all.filter(byType('conflict')), function (w, li) {
      li.appendChild(document.createTextNode(w.fy + '年度 / ' + w.name + ' / ' + SLOT_LABELS[w.slot] + '： '));
      appendRecLinks(li, w.recordIds);
      li.appendChild(document.createTextNode('（No.' + w.chosenId + ' を採用） ' + locSuffix(w)));
    });

    section('同姓同名・同一生年月日の疑い', all.filter(byType('dupname')), function (w, li) {
      li.appendChild(document.createTextNode(w.fy + '年度 / ' + w.name + '（' + w.birthday + '）： 理由＝' + w.reasons.join(' / ') + '　該当レコード: '));
      appendRecLinks(li, w.recordIds);
      li.appendChild(document.createTextNode(' ' + locSuffix(w)));
    });

    section('通所施設がマスタ未登録（アプリ146/147）', all.filter(byType('facility_unregistered')), function (w, li) {
      li.appendChild(document.createTextNode(w.fy + '年度 / ' + w.name + '： 施設「' + w.facility + '」が登録されていません。市町村タブは「契約」（居住地: ' + (w.contract || '（空）') + '）を暫定使用しています。該当レコード: '));
      appendRecLinks(li, w.recordIds);
    });

    section('児童氏名マスタ（アプリ10）に一致するレコードなし', all.filter(byType('app10_missing')), function (w, li) {
      li.appendChild(document.createTextNode(w.fy + '年度 / ' + w.name + '： アプリ10に同名のレコードが見つからないため、氏名からのリンクを設定できません。 ' + locSuffix(w) + ' 該当レコード: '));
      appendRecLinks(li, w.recordIds);
    });

    section('児童氏名マスタ（アプリ10）で同姓同名を検出', all.filter(byType('app10_ambiguous')), function (w, li) {
      li.appendChild(document.createTextNode(w.fy + '年度 / ' + w.name + '： アプリ10に同名のレコードが複数あるため、最新のレコード（No.' + w.allIds[w.allIds.length - 1] + '）へ暫定的にリンクしています。 ' + locSuffix(w) + ' アプリ10の該当レコード: '));
      appendRecLinks(li, w.allIds, CONFIG.CROSS_APPS.CHILD.APP_ID);
    });

    section('「契約」フィールドの固定7町以外の値', all.filter(byType('extramuni')), function (w, li) {
      li.appendChild(document.createTextNode(w.fy + '年度： 「' + w.values.join('」「') + '」を検出しました（入力ミスの可能性。市町村タブの判定自体は施設エリア基準のため影響ありません）。'));
    });

    section('参考警告（年度に紐づかないフィールド定義・年度不明のデータ）', all.filter(function (w) {
      return w.type === 'status_hidden' || w.type === 'status_diff' ||
        (w.type === 'unclassified' && (w.fy === null || w.fy === undefined));
    }), function (w, li) {
      if (w.type === 'status_hidden') {
        li.appendChild(document.createTextNode(w.fy + '年度 / ' + w.name + '： 利用状況「' + w.status + '」が既知の値でないため今年度一覧に表示されません。 ' + locSuffix(w) + ' '));
        appendRecLinks(li, w.recordIds);
      } else if (w.type === 'status_diff') {
        var parts = [];
        if (w.missing.length) parts.push('不足: ' + w.missing.join(' / '));
        if (w.extra.length) parts.push('追加: ' + w.extra.join(' / '));
        li.appendChild(document.createTextNode('「利用状況」の選択肢がCONFIG.STATUS_KNOWNと異なります（' + parts.join('、') + '）。参考照合のため動作は継続します。'));
      } else {
        li.appendChild(recLink(w.recordId));
        li.appendChild(document.createTextNode(' ' + w.name + '： ' + w.detail + '（短期開始日から年度を特定できないため常時表示） ' + locSuffix(w)));
      }
    });
  }

  /** 全パーツ再描画 */
  function renderAll() {
    renderFYOptions();
    renderSearchUI();
    renderTabs();
    renderFacTabs();
    renderTantoFilter();
    renderTable();
    renderWarnings();
  }

  // ================================================================
  // Block 4/4 : 状態保存・復元 / イベント / エントリポイント
  // ================================================================

  // ---------------- 状態保存・復元 ----------------
  // 検索ボックスの入力内容はセッションをまたいで保持する意味が薄いため保存対象外（裁量判断）。

  function saveState() {
    try {
      var w = state.els.tableWrap;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        fy: state.fy,
        tabKey: state.tabKey,
        facEnSelected: state.facEnSelected,
        facGakkoSelected: state.facGakkoSelected,
        tanto: state.tanto,
        scrollX: w ? w.scrollLeft : 0,
        scrollY: w ? w.scrollTop : 0
      }));
    } catch (e) { /* sessionStorage不可でも動作継続 */ }
  }

  function loadSavedState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /** 保存値が「null または {文字列キー:true,...} 形式のオブジェクト」であることを確認する */
  function isValidFacSelection(v) {
    if (v === null) return true;
    if (typeof v !== 'object' || Array.isArray(v)) return false;
    return Object.keys(v).every(function (k) { return v[k] === true; });
  }

  function applyInitialState() {
    var saved = loadSavedState();
    var fy = state.currentFY;
    var facEnSelected = null;
    var facGakkoSelected = null;
    var tanto = TANTO_ALL;
    if (saved) {
      if (typeof saved.fy === 'number' && state.model.fyList.indexOf(saved.fy) !== -1) fy = saved.fy;
      if (isValidFacSelection(saved.facEnSelected)) facEnSelected = saved.facEnSelected;
      if (isValidFacSelection(saved.facGakkoSelected)) facGakkoSelected = saved.facGakkoSelected;
      if (typeof saved.tanto === 'string' && saved.tanto) tanto = saved.tanto;
    }
    state.fy = fy;
    state.tanto = tanto;
    // 市町村タブは常に「すべて」から開始する仕様のため、保存値があっても復元しない
    // （年度・担当・段選択・スクロール位置は引き続き復元する）
    state.tabKey = TAB_ALL;
    // 段選択の存在チェックはpassesFacRowFilter()が毎回動的に行うため、ここでは復元値をそのまま保持する
    state.facEnSelected = facEnSelected;
    state.facGakkoSelected = facGakkoSelected;
    state.searchText = '';
    state.savedScroll = saved ? { x: saved.scrollX || 0, y: saved.scrollY || 0 } : null;
  }

  function restoreScroll() {
    if (!state.savedScroll) return;
    var w = state.els.tableWrap;
    var s = state.savedScroll;
    state.savedScroll = null;
    if (!w) return;
    window.requestAnimationFrame(function () {
      w.scrollLeft = s.x;
      w.scrollTop = s.y;
    });
  }

  // ---------------- イベントハンドラ ----------------

  function onFYChange() {
    var fy = Number(state.els.fySelect.value);
    state.fy = fy;
    state.tabKey = normalizeTabKey(state.model, fy, state.currentFY, state.tabKey);
    // 年度を跨ぐと園/学校の実体が変わりうるため段の選択は「すべて選択」にリセット
    state.facEnSelected = null;
    state.facGakkoSelected = null;
    renderTabs();
    renderFacTabs();
    renderTantoFilter();
    renderTable();
    renderWarnings();   // 年度紐づけ表示のため警告も再集計
    saveState();
  }

  function onSearchInput() {
    state.searchText = state.els.searchInput.value;
    renderSearchUI();
    renderTable();
    saveState();
  }

  function onSearchClear() {
    state.searchText = '';
    state.els.searchInput.value = '';
    renderSearchUI();
    renderTable();
    saveState();
  }

  function onTantoChange() {
    state.tanto = state.els.tantoSelect.value;
    // 人数バッジが担当フィルタ後の値になるため、タブ・サブタブも再描画
    renderTabs();
    renderFacTabs();
    renderTable();
    saveState();
  }

  function onTabClick(ev) {
    var t = ev.target;
    var btn = (t && t.closest) ? t.closest('.a42m-tab') : null;
    if (!btn || !state.els.tabbar.contains(btn)) return;
    var key = btn.dataset.key;
    if (!key || key === state.tabKey) return;
    state.tabKey = key;
    state.facEnSelected = null;    // 市町村タブ切替時は両段とも「すべて選択」にリセット
    state.facGakkoSelected = null;
    renderTabs();
    renderFacTabs();
    renderTable();
    saveState();
  }

  /**
   * 園/学校2段サブタブのクリック（fieldは'en'または'gakko'）。複数選択方式。
   *  - 「すべて」ボタン: トグル動作。現在null（全選択状態）ならすべて解除({})へ、
   *    それ以外（全解除状態または個別選択状態）ならnull（全選択状態）へ戻す。
   *  - 個別チップ: 現在「すべて選択」状態(null)なら、直近描画したタブ一覧を材料に
   *    「全キーを選択済みにした状態」を作った上で、クリックされたキーだけを外す
   *    （＝1件だけ選択解除した状態に遷移）。既に個別選択状態であれば、単純に
   *    そのキーの選択有無をトグルする。
   */
  function onFacRowToggle(ev, field) {
    var t = ev.target;
    var rowEl = (field === 'en') ? state.els.enRow : state.els.gakkoRow;
    if (!rowEl.contains(t)) return;

    var allBtn = (t && t.closest) ? t.closest('.a42m-allswitch') : null;
    if (allBtn) {
      var currentAll = (field === 'en') ? state.facEnSelected : state.facGakkoSelected;
      var nextAll = (currentAll === null) ? {} : null;
      if (field === 'en') state.facEnSelected = nextAll; else state.facGakkoSelected = nextAll;
      renderFacTabs();
      renderTable();
      saveState();
      return;
    }

    var chip = (t && t.closest) ? t.closest('.a42m-subtab') : null;
    if (!chip) return;
    var key = chip.dataset.fkey;
    if (!key) return;

    var tabsCache = (field === 'en') ? state.enTabsCache : state.gakkoTabsCache;
    var current = (field === 'en') ? state.facEnSelected : state.facGakkoSelected;
    var next;
    if (current === null) {
      next = {};
      tabsCache.forEach(function (tb) { next[tb.key] = true; });
      delete next[key];
    } else {
      next = {};
      Object.keys(current).forEach(function (k) { next[k] = true; });
      if (next[key]) delete next[key]; else next[key] = true;
    }
    if (field === 'en') state.facEnSelected = next; else state.facGakkoSelected = next;
    renderFacTabs();   // もう一方の段のバッジ数もクロス再計算される
    renderTable();
    saveState();
  }

  function onReload() {
    saveState();
    state.model = null;
    var root = state.els.root || document.getElementById('a42m-root');
    if (root) loadEverything(root);
  }

  function onWarnToggle() {
    var p = state.els.warnPanel;
    p.style.display = (p.style.display === 'none' || !p.style.display) ? '' : 'none';
  }

  // ---------------- 起動パイプライン ----------------

  var ABORT = { a42mAbort: true };

  /** 検証→全件取得（アプリ42・146・147を並行取得）→モデル構築→描画 */
  function loadEverything(root) {
    renderLoading(root, '起動時検証中…');
    var progress = { app42: 0, school: 0, en: 0, child: 0 };
    function progressText() {
      return 'マスタ・レコード読込中…（支援計画 ' + progress.app42 + '件 / 学校一覧 ' + progress.school + '件 / 園一覧 ' + progress.en + '件 / 児童氏名マスタ ' + progress.child + '件）';
    }
    validateForm()
      .then(function (v) {
        if (v.fatal.length) {
          renderFatal(root, v.fatal);
          throw ABORT;
        }
        state.validation = v;
        updateLoadingText(progressText());
        return Promise.all([
          fetchAllRecords(function (n) { progress.app42 = n; updateLoadingText(progressText()); }),
          fetchAreaMap(CONFIG.CROSS_APPS.SCHOOL, function (n) { progress.school = n; updateLoadingText(progressText()); }),
          fetchAreaMap(CONFIG.CROSS_APPS.EN, function (n) { progress.en = n; updateLoadingText(progressText()); }),
          fetchChildMap(function (n) { progress.child = n; updateLoadingText(progressText()); })
        ]);
      })
      .then(function (results) {
        var records = results[0];
        var schoolAreaMap = results[1];
        var enAreaMap = results[2];
        var childMap = results[3];
        state.model = buildModel(records, state.currentFY, schoolAreaMap, enAreaMap, childMap);
        applyInitialState();
        renderShell(root);
        renderAll();
        restoreScroll();
        saveState();
      })
      .catch(function (err) {
        if (err === ABORT) return;
        try { console.error('[a42m] ', err); } catch (e2) { /* no-op */ }
        renderError(root, err);
      });
  }

  function boot(root) {
    state.appId = kintone.app.getId();
    state.currentFY = computeCurrentFY();
    if (state.model) {
      applyInitialState();
      renderShell(root);
      renderAll();
      restoreScroll();
      return;
    }
    loadEverything(root);
  }

  // ---------------- エントリポイント ----------------

  if (typeof kintone !== 'undefined' && kintone.events) {
    kintone.events.on('app.record.index.show', function (event) {
      if (CONFIG.VIEW_ID !== null) {
        if (String(event.viewId) !== String(CONFIG.VIEW_ID)) return event;
      } else if (event.viewName !== CONFIG.VIEW_NAME) {
        return event;
      }
      var root = document.getElementById('a42m-root');
      if (!root) return event;
      if (root.dataset.a42mBound === '1') return event;
      root.dataset.a42mBound = '1';
      boot(root);
      return event;
    });
  }

  // ---------------- Node.jsテスト用エクスポート（kintone実行時は無影響） ----------------

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CONFIG: CONFIG,
      parseDate: parseDate,
      computeCurrentFY: computeCurrentFY,
      computeGrade: computeGrade,
      gradeMaster: gradeMaster,
      normalizeKana: normalizeKana,
      matchesSearch: matchesSearch,
      classify: classify,
      isKnownPlan: isKnownPlan,
      countsFor: countsFor,
      mergeSameTypeCandidates: mergeSameTypeCandidates,
      resolveConflict: resolveConflict,
      facilityInfo: facilityInfo,
      facilityNoteInfo: facilityNoteInfo,
      facilityAreaOf: facilityAreaOf,
      isPreschoolApplicable: isPreschoolApplicable,
      isSchoolApplicable: isSchoolApplicable,
      facRowApplicable: facRowApplicable,
      buildModel: buildModel,
      getRoster: getRoster,
      childCompare: childCompare,
      rosterForTab: rosterForTab,
      buildTabList: buildTabList,
      normalizeTabKey: normalizeTabKey,
      buildTantoOptions: buildTantoOptions,
      passesFacRowFilter: passesFacRowFilter,
      buildFacRowTabs: buildFacRowTabs,
      isWarningVisibleForYear: isWarningVisibleForYear,
      crossRecordUrl: crossRecordUrl,
      TAB_UNSET: TAB_UNSET,
      TAB_ALL: TAB_ALL,
      TANTO_ALL: TANTO_ALL,
      TANTO_NONE: TANTO_NONE,
      FAC_UNSET: FAC_UNSET
    };
  }
})();
