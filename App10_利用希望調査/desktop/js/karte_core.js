/* =====================================================================
 * karte_core.js — いろ葉カルテ v2 共通コア
 *
 * 搭載先: アプリ11(カルテ) と アプリ10(利用者リスト) の【両方】
 *   ※両アプリで完全に同一のファイル。更新時は必ず両方に再アップロードすること。
 *   ※各アプリのスクリプトより先に読み込むこと。
 *
 * 提供するもの
 *   KARTE.CONFIG      設定・全フィールドコード(ここ1箇所に隔離)
 *   KARTE.util        日付・時刻・文字列などのユーティリティ
 *   KARTE.h           DOM生成ヘルパー
 *   KARTE.api         kintone REST ラッパ
 *   KARTE.master      マスタ/設定レコードへのアクセス(常にアプリ11を参照)
 *   KARTE.fetchChildren / fetchGradeMap / fetchMyOffice
 *   KARTE.validateData / recordToData
 *   KARTE.checkEngine 作成チェックの判定エンジンと詳細ポップアップ(3画面で共用)
 *
 * 設計書 v2.0 準拠(§2 フィールド設計 / §5 判定ロジック / §6 ファイル構成)
 * =================================================================== */
(function () {
  'use strict';
  const KARTE = (window.KARTE = window.KARTE || {});

  /* ===================================================================
   * 1. 設定
   * 【重要】アプリ11のフィールドコードは全てここに集約している(設計書 §0 P3)。
   * フィールドコードのリネームが未実施・一部失敗した場合は、
   * この F の該当行を実際のコードに書き換えるだけで動作する。
   * =================================================================== */
  const CONFIG = (KARTE.CONFIG = {
    APP11_ID: 11,   // カルテ(本番)
    APP10_ID: 10,   // 利用者リスト(児童マスタ)
    APP50_ID: 50,   // 職員マスタ
    APP67_ID: 67,   // 安全管理(参照しない。事故報告はリンクフィールドのみ)

    /* ---- アプリ10(利用者リスト)のフィールドコード ---- */
    A10: {
      name: '児童氏名',
      kana: '児童フリガナ',
      status: '利用状況',
      office: '通所先',
      days: '利用曜日',      // チェックボックス(月〜土)
      time: '利用時間',      // ラベルは「主な利用時間」
      stage: '太田ステージ',
      grade: '学年',
      contract: '契約日',    // 利用開始日として使用(設計書 §2.5)
    },
    STATUS_ACTIVE: '利用中',

    /* ---- アプリ50(職員マスタ) ---- */
    A50: { name: '氏名', dept: '配属' }, // 氏名はユーザー選択、配属はドロップダウン

    /* ---- アプリ11(カルテ)のフィールドコード ----
     * ★リネーム後の想定コード。リネーム前は右のコメントの旧コードになる。 */
    F: {
      // 新設(setup_02で作成)
      kind: 'レコード種別',
      room: '部屋',
      attend: '出欠区分',
      absentReason: '欠席理由',
      unplanned: '予定外',
      // 新設(マスタ/設定用)
      mName: 'マスタ名称',
      mValue: 'マスタ値',
      mJson: 'マスタJSON',
      mMonth: 'マスタ対象月',

      /* ---- 既存フィールド ----
       * 【重要】kintone REST API はフィールドコードのリネームに対応していない
       * (GAIA_FC01エラーで実機確認済み)。管理画面での手作業リネームも行わず、
       * 実際に監査で確認できた"生"のフィールドコードをそのままここに書く。
       * ラベル(画面上の表示名)は分かりやすいままなので、運用上の支障はない。
       * このCONFIG.Fの右辺だけが唯一の真実であり、他のファイルはコードを直接書かない。 */
      date: '本日日付',           // ラベル表示は「日付」
      time: '時刻',
      name: 'ルックアップ_0',      // ラベル表示は「氏名」(アプリ10へのルックアップ)
      kana: '文字列__1行__30',    // ラベル表示は「カタカナ」
      office: '文字列__1行__28',  // ラベル表示は「通所先」
      stage: '文字列__1行__1',    // ラベル表示は「太田ステージ」
      menu: 'ドロップダウン',      // ラベル表示は「メニュー」
      parentInfo: '保護者',       // ラベル表示は「保護者からの情報」
      personalNote: '個別SV',     // ラベル表示は「【個別】総評・SV・特記事項・備考」
      overall: '全体SV',          // ラベル表示は「【全体】総評・SV・特記事項・備考」
      staff: '記入担当者',        // 変更なし(ユーザー選択)
      files: '添付ファイル',      // 変更なし
      accidentLink: 'リンク',     // ラベル表示は「事故発生報告書リンク」

      // 活動明細(サブテーブル)
      table: '活動サブテーブル',   // ラベル表示は「活動内容」
      tAct: '活動',              // 文字列1行
      tAim: 'ねらい',            // 複数行
      tTate: '方法',             // 複数行(品質基準の判定対象)
      tEval: '評価',             // ラジオボタン ◎/○/△
      tComment: 'コメント',       // 複数行

      // 同席児童(既存のルックアップ8個 + そのステージ表示8個)
      // 同席児童は「G1〜G8」(文字列1行。ラベル表示もG1〜G8)に書き込む。
      // 【監査で判明】「グループ1〜8」(ルックアップ)のコピー元は児童氏名で、
      // 「他のフィールドのコピー」設定によりG1〜8にも同じ児童氏名が複製される仕組みだった。
      // つまりG1〜8は元々グループ1〜8と同一内容を持つ文字列版であるため、
      // ルックアップではなくこちらに直接書き込むことで、
      // 「ルックアップの取得を行ってください」等の保存時エラーの懸念を根本から無くせる。
      // 過去データとの整合性も保たれる(元々同じ値を持っていたフィールドのため)。
      // ラベル表示は G1〜G8 のまま(コードだけ下記の生のコード)。
      groups: ['文字列__1行__18', '文字列__1行__11', '文字列__1行__12', '文字列__1行__17',
               '文字列__1行__16', '文字列__1行__15', '文字列__1行__26', '文字列__1行__27'],
      // ラベル表示は 太田ステージ1〜8 のまま(コードだけ下記の生のコード)。
      groupStages: ['文字列__1行__9', '文字列__1行__10', '文字列__1行__20', '文字列__1行__22',
                    '文字列__1行__24', '文字列__1行__5', '文字列__1行__8', '文字列__1行__14'],

      // 従来のグループメンバー欄(ルックアップ)。読み書きはしない(表示/非表示の切替のみに使う)。
      // ラベルは「グループ1」〜「グループ8」で一意なので、フィールドコード自動検出の対象にできる。
      groupsLookup: ['ルックアップ', 'ルックアップ_1', 'ルックアップ_2', 'ルックアップ_3',
                     'ルックアップ_4', 'ルックアップ_5', 'ルックアップ_6', 'ルックアップ_7'],
      // グループ1〜8にぶら下がる関連レコード一覧(9個。ラベルが全て同じ「関連レコード一覧」で
      // 一意に絞れないため自動検出の対象にはできない。表示/非表示の切替のみに使う)。
      relatedTables: ['関連レコード一覧_0', '関連レコード一覧_1', '関連レコード一覧_2', '関連レコード一覧_3',
                      '関連レコード一覧_4', '関連レコード一覧_5', '関連レコード一覧_6', '関連レコード一覧_7',
                      '関連レコード一覧_8'],
    },

    /* ---- レコード種別 ---- */
    KIND: {
      record: '支援記録',
      sys: 'システム設定',
      check: 'チェック月次',
    },

    /* ---- 出欠区分 ---- */
    ATTEND: { present: '出席', absentPre: '事前欠席', absentDay: '直近欠席' },
    ABSENT_STATUSES: ['事前欠席', '直近欠席'],
    ABSENT_REASONS: [
      '家族より本人の体調不良により欠席の連絡がある。体調等の確認を行い、次回の利用日程を確認する。',
      '家族の都合により欠席の連絡がある。次回の利用日程の確認を行う。',
      '保育所・学校の臨時休業のため',
    ],

    OFFICES: [{ code: 'T', label: '玉城' }, { code: 'M', label: '明和' }],

    /* ---- 部屋(両事業所共通) ---- */
    ROOMS: ['うさぎ', 'りす', 'ぞう', 'らいおん', '1', '2', '3', '4'],
    ROOM_COLORS: {
      'うさぎ': '#2e9e6b', 'りす': '#d9534f', 'ぞう': '#8e5fd0', 'らいおん': '#d98b1f',
      '1': '#e0457b', '2': '#1f8fd6', '3': '#c0392b', '4': '#5b8c2a',
    },

    EVALS: ['◎', '○', '△'],
    EVAL_ON_COPY: '○',   // カルテコピー時に評価へ入れておく値(設計書 §3.2 F3)
    WEEKDAYS: ['日', '月', '火', '水', '木', '金', '土'],

    /* ---- システム設定のキー名 ---- */
    SYS_KEYS: {
      cutover: 'チェック基準適用開始日',
      quality: '手立て品質基準',
      holidays: '休業日リスト',
    },
    DEFAULT_QUALITY: { minChars: 40, minLines: 2 },

    MAX_PEERS: 8,        // 同席児童の上限
    SUGGEST_DAYS: 90,    // 入力補助の候補を集計する期間(日)
    SUGGEST_MAX: 120,    // 候補の最大件数
    COPY_LOOKBACK: 180,  // カルテコピーの検索対象期間(日)
    COPY_LIST_SIZE: 20,  // カルテコピーの一覧件数
    FALLBACK_TIMES: ['09:30', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
  });

  const C = CONFIG, F = C.F, K = C.KIND;

  /* ===================================================================
   * 1.5 フィールドコードの自動検出(手動リネーム対応)
   *
   * kintoneのフィールドコードは管理画面から手動でリネームできる(APIでは不可)。
   * 今後、誰かが管理画面でコードを変更しても動作し続けるよう、
   * 「CONFIGに書いたコードが実際には存在しない場合、同じラベル(画面表示名)を
   * 持つフィールドを探して自動的に差し替える」仕組みを起動時に1回だけ実行する。
   *
   * ・ラベルが変わっていなければ、コードがどう変わっても自動的に追随する
   * ・見つからない場合は警告を出すだけで、設定済みのコードのまま動作を続ける
   *   (すぐに壊れるのではなく、従来通りのエラーメッセージで気づける)
   * ・各カスタマイズファイルの起動時に KARTE.ensureFieldsResolved() を呼ぶだけでよい
   * =================================================================== */

  // 各フィールドの「変わらない目印」となるラベル(現在の表示名)。
  // コードが変わっても、このラベルが同じであれば自動検出できる。
  const F_LABELS = {
    date: '日付', time: '時刻', name: '氏名', kana: 'カタカナ', office: '通所先',
    stage: '太田ステージ', menu: 'メニュー', parentInfo: '保護者からの情報',
    personalNote: '【個別】総評・SV・特記事項・備考', overall: '【全体】総評・SV・特記事項・備考',
    staff: '記入担当者', files: '添付ファイル', accidentLink: '事故発生報告書リンク',
    table: '活動内容',
    kind: 'レコード種別', room: '部屋', attend: '出欠区分', absentReason: '欠席理由', unplanned: '予定外',
    mName: '名称(マスタ用)', mValue: '値(マスタ用)', mJson: 'JSONデータ(マスタ用)', mMonth: '対象月(マスタ用)',
    tAct: '活動', tAim: 'ねらい（箇条書き）', tTate: '方法・手立て（具体的に記載）専門的支援実施内容',
    tEval: '評価', tComment: 'コメント',
  };
  const A10_LABELS = {
    name: '児童氏名', kana: '児童フリガナ', status: '利用状況', office: '通所先',
    days: '利用曜日', time: '主な利用時間', stage: '太田ステージ', grade: '学年', contract: '契約日',
  };

  let fieldsResolvedFor = {}; // { appId: true }
  let resolvePromises = {};  // { appId: Promise }

  // アプリのフィールド一覧を「コード→定義」「ラベル→コード配列」に整形する(サブテーブル内も展開)
  function flattenFieldsForLookup(properties) {
    const byCode = {}, byLabel = {};
    Object.keys(properties).forEach((code) => {
      const f = properties[code];
      byCode[code] = f;
      if (f.label) (byLabel[f.label] = byLabel[f.label] || []).push(code);
      if (f.type === 'SUBTABLE' && f.fields) {
        Object.keys(f.fields).forEach((sc) => {
          const sf = f.fields[sc];
          byCode[sc] = sf;
          if (sf.label) (byLabel[sf.label] = byLabel[sf.label] || []).push(sc);
        });
      }
    });
    return { byCode: byCode, byLabel: byLabel };
  }

  // codesObj の各プロパティ(文字列、または文字列の配列)を検証し、
  // 存在しなければ labelsObj の対応するラベル(配列の場合は labelFn(i) )から自動検出する。
  // codesObj 自体を書き換える(参照を保っている他のコードにも反映される)。
  function resolveInto(codesObj, labelsObj, arrayLabelFns, byCode, byLabel, tag, warnings) {
    Object.keys(codesObj).forEach((key) => {
      const val = codesObj[key];
      if (Array.isArray(val)) {
        const labelFn = arrayLabelFns && arrayLabelFns[key];
        if (!labelFn) return;
        val.forEach((code, i) => {
          if (byCode[code]) return; // 現状のコードで存在するので何もしない
          const label = labelFn(i);
          const hit = byLabel[label];
          if (hit && hit.length === 1) {
            warnings.push(tag + '.' + key + '[' + i + ']: 「' + code + '」が見つからないため、' +
              'ラベル「' + label + '」から「' + hit[0] + '」を自動検出しました。');
            val[i] = hit[0];
          } else {
            warnings.push('⚠ ' + tag + '.' + key + '[' + i + ']: 「' + code + '」が見つからず、' +
              'ラベル「' + label + '」からも自動検出できませんでした(' +
              (hit ? hit.length + '件ヒットし絞れない' : '該当なし') + ')。設定のままにします。');
          }
        });
        return;
      }
      if (typeof val !== 'string') return;
      if (byCode[val]) return; // 現状のコードで存在するので何もしない
      const label = labelsObj[key];
      if (!label) return; // ラベル未登録のキーは対象外(mKind等、値がコードでないもの)
      const hit = byLabel[label];
      if (hit && hit.length === 1) {
        warnings.push(tag + '.' + key + ': 「' + val + '」が見つからないため、' +
          'ラベル「' + label + '」から「' + hit[0] + '」を自動検出しました。');
        codesObj[key] = hit[0];
      } else {
        warnings.push('⚠ ' + tag + '.' + key + ': 「' + val + '」が見つからず、' +
          'ラベル「' + label + '」からも自動検出できませんでした(' +
          (hit ? hit.length + '件ヒットし絞れない' : '該当なし') + ')。設定のままにします。');
      }
    });
  }

  // アプリ11(カルテ)のフィールドコードを解決する。設計書の想定コードが
  // 手動でリネームされていても、ラベルが同じなら自動的に追随する。
  KARTE.ensureFieldsResolved = async (appId) => {
    const app11 = appId || C.APP11_ID;
    const key = 'app11:' + app11;
    if (fieldsResolvedFor[key]) return;
    if (resolvePromises[key]) return resolvePromises[key];

    resolvePromises[key] = (async () => {
      const warnings = [];
      try {
        const props = await A.getFormFields(app11);
        const { byCode, byLabel } = flattenFieldsForLookup(props);
        const groupLabelFn = (i) => 'G' + (i + 1);
        const stageLabelFn = (i) => '太田ステージ' + (i + 1);
        const groupsLookupLabelFn = (i) => 'グループ' + (i + 1);
        resolveInto(F, F_LABELS,
          { groups: groupLabelFn, groupStages: stageLabelFn, groupsLookup: groupsLookupLabelFn },
          byCode, byLabel, 'F', warnings);
        // relatedTables(9個)はラベルが全て同一で一意に絞れないため自動検出しない。存在確認のみ行う。
        (F.relatedTables || []).forEach((code, i) => {
          if (!byCode[code]) warnings.push('⚠ F.relatedTables[' + i + ']: 「' + code + '」が見つかりません(ラベル一意でないため自動検出不可。手動確認が必要)。');
        });
      } catch (e) {
        warnings.push('⚠ アプリ' + app11 + 'のフィールド取得に失敗したため、自動検出をスキップしました: ' + (e.message || e));
      }
      if (warnings.length) {
        console.warn('%c[KARTE] フィールドコードの自動検出結果(アプリ' + app11 + ')', 'color:#b8770f; font-weight:bold');
        warnings.forEach((w) => console.warn('  ' + w));
      }
      fieldsResolvedFor[key] = true;
    })();
    return resolvePromises[key];
  };

  // アプリ10(利用者リスト)のフィールドコードを解決する。
  KARTE.ensureApp10FieldsResolved = async () => {
    const key = 'app10:' + C.APP10_ID;
    if (fieldsResolvedFor[key]) return;
    if (resolvePromises[key]) return resolvePromises[key];

    resolvePromises[key] = (async () => {
      const warnings = [];
      try {
        const props = await A.getFormFields(C.APP10_ID);
        const { byCode, byLabel } = flattenFieldsForLookup(props);
        resolveInto(C.A10, A10_LABELS, null, byCode, byLabel, 'A10', warnings);
      } catch (e) {
        warnings.push('⚠ アプリ' + C.APP10_ID + 'のフィールド取得に失敗したため、自動検出をスキップしました: ' + (e.message || e));
      }
      if (warnings.length) {
        console.warn('%c[KARTE] フィールドコードの自動検出結果(アプリ10)', 'color:#b8770f; font-weight:bold');
        warnings.forEach((w) => console.warn('  ' + w));
      }
      fieldsResolvedFor[key] = true;
    })();
    return resolvePromises[key];
  };

  // テスト等でキャッシュをリセットしたい場合に使う
  KARTE.resetFieldResolutionCache = () => { fieldsResolvedFor = {}; resolvePromises = {}; };

  /* ===================================================================
   * 2. ユーティリティ
   * =================================================================== */
  const U = (KARTE.util = {});

  U.pad2 = (n) => ('0' + n).slice(-2);
  U.fmtDate = (d) => d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  U.todayStr = () => U.fmtDate(new Date());
  U.parseDate = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  U.weekdayJa = (dateStr) => {
    const d = U.parseDate(dateStr);
    return d ? C.WEEKDAYS[d.getDay()] : '';
  };
  U.monthOf = (dateStr) => String(dateStr || '').slice(0, 7);
  U.monthRange = (monthStr) => {
    const [y, m] = monthStr.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { start: monthStr + '-01', end: monthStr + '-' + U.pad2(last), days: last, y: y, m: m };
  };
  U.addDays = (dateStr, n) => {
    const d = U.parseDate(dateStr) || new Date();
    d.setDate(d.getDate() + n);
    return U.fmtDate(d);
  };
  U.addMonths = (monthStr, n) => {
    const mr = U.monthRange(monthStr);
    const d = new Date(mr.y, mr.m - 1 + n, 1);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1);
  };
  U.prevMonthStr = () => U.addMonths(U.thisMonthStr(), -1);
  U.thisMonthStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1);
  };

  // 指定日を含む週の日付7件(月曜始まり)
  U.weekDates = (dateStr, startDow) => {
    const base = U.parseDate(dateStr) || new Date();
    const sd = startDow == null ? 1 : startDow;
    const diff = (base.getDay() - sd + 7) % 7;
    const start = new Date(base);
    start.setDate(start.getDate() - diff);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      out.push(U.fmtDate(d));
    }
    return out;
  };

  // 指定月に含まれる各週の開始日
  U.weekStartsOfMonth = (monthStr, startDow) => {
    const mr = U.monthRange(monthStr);
    const seen = {}, out = [];
    for (let d = 1; d <= mr.days; d++) {
      const ws = U.weekDates(monthStr + '-' + U.pad2(d), startDow)[0];
      if (!seen[ws]) { seen[ws] = 1; out.push(ws); }
    }
    return out;
  };

  U.datesOfMonth = (monthStr) => {
    const mr = U.monthRange(monthStr);
    const out = [];
    for (let d = 1; d <= mr.days; d++) out.push(monthStr + '-' + U.pad2(d));
    return out;
  };

  /* ---- 日本の祝日の自動計算(毎年自動。手動更新不要) ----
   * 「国民の祝日に関する法律」のルール(ハッピーマンデー・春分/秋分の天文計算・
   * 振替休日・国民の休日)を実装。天文計算式は1980〜2099年で有効。
   * 2020年以降の天皇誕生日(2/23)を前提とする。
   * ※v1で内閣府公式CSVと2026年・2027年の完全一致を検証済み。 */
  function nthMondayOfMonth(year, month, n) {
    const first = new Date(year, month - 1, 1);
    const firstMonday = 1 + ((8 - first.getDay()) % 7);
    return new Date(year, month - 1, firstMonday + (n - 1) * 7);
  }
  const shunbunDay = (y) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const shubunDay = (y) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

  U.japanHolidays = (year) => {
    const d = (m, day) => new Date(year, m - 1, day);
    const base = [
      d(1, 1), nthMondayOfMonth(year, 1, 2), d(2, 11), d(2, 23),
      d(3, shunbunDay(year)), d(4, 29), d(5, 3), d(5, 4), d(5, 5),
      nthMondayOfMonth(year, 7, 3), d(8, 11), nthMondayOfMonth(year, 9, 3),
      d(9, shubunDay(year)), nthMondayOfMonth(year, 10, 2), d(11, 3), d(11, 23),
    ];
    const set = new Set(base.map(U.fmtDate));

    // 振替休日: 祝日が日曜なら、その後の最初の非祝日
    const extra = [];
    set.forEach((ds) => {
      const dt = U.parseDate(ds);
      if (dt.getDay() !== 0) return;
      const next = new Date(dt);
      do { next.setDate(next.getDate() + 1); } while (set.has(U.fmtDate(next)));
      extra.push(U.fmtDate(next));
    });
    extra.forEach((ds) => set.add(ds));

    // 国民の休日: 祝日に挟まれた平日
    Array.from(set).sort().forEach((ds) => {
      const dt = U.parseDate(ds);
      const next = new Date(dt); next.setDate(next.getDate() + 1);
      const after = new Date(next); after.setDate(after.getDate() + 1);
      if (!set.has(U.fmtDate(next)) && set.has(U.fmtDate(after)) && next.getDay() !== 0) {
        set.add(U.fmtDate(next));
      }
    });
    return Array.from(set).sort();
  };

  /* ---- 時刻 ---- */
  U.timeToMin = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2}):(\d{2})/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^(\d{3,4})$/);
    if (m) { const n = m[1]; return +n.slice(0, n.length - 2) * 60 + +n.slice(-2); }
    return null;
  };
  U.minToHM = (min) => (min == null ? '' : U.pad2(Math.floor(min / 60)) + ':' + U.pad2(min % 60));
  U.normHM = (v) => U.minToHM(U.timeToMin(v));

  /* ---- 文字列 ---- */
  U.normName = (s) => String(s || '').replace(/[\s\u3000]/g, '');
  U.uid = () => 'u' + Math.random().toString(36).slice(2, 10);
  U.debounce = (fn, ms) => {
    let t = null;
    return function () {
      clearTimeout(t);
      const args = arguments, self = this;
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  };
  U.trunc = (s, n) => {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  // ユーザー選択フィールドの値([{code,name}])から氏名配列を取り出す
  U.userNames = (v) => {
    if (v == null || v === '') return [];
    if (!Array.isArray(v)) v = [v];
    return v.map((u) => {
      if (u == null) return '';
      if (typeof u === 'string') return u;
      return String(u.name || u.code || '');
    }).filter(Boolean);
  };
  U.joinNames = (arr) => (arr || []).join('・');

  // textareaの高さを内容に合わせて自動調整(モーダル内でのみ使用。標準フォームには適用しない)
  U.autoGrow = (ta, minRows) => {
    if (!ta) return ta;
    const min = minRows || 2;
    const fit = () => {
      ta.style.height = 'auto';
      const line = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.style.height = Math.max(ta.scrollHeight + 2, line * min + 16) + 'px';
    };
    ta.style.overflowY = 'hidden';
    ta.addEventListener('input', fit);
    setTimeout(fit, 0);
    return ta;
  };

  /* ===================================================================
   * 3. DOMヘルパー
   * =================================================================== */
  const h = (KARTE.h = function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'disabled') el.disabled = !!v;
        else if (k === 'selected') el.selected = !!v;
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null) continue;
      if (Array.isArray(kid)) {
        kid.forEach((c) => c != null && el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
      } else {
        el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
      }
    }
    return el;
  });

  /* ===================================================================
   * 4. kintone REST ヘルパー
   * =================================================================== */
  const A = (KARTE.api = {});

  // GETでクエリ文字列にパラメータを載せる場合、Content-Type を付けると CB_IL02 になる。
  // JSON本文がある時だけヘッダを付ける(v1の不具合#2の回避)。
  A.call = (path, method, params) => kintone.api(kintone.api.url(path, true), method, params);

  // カーソルAPIで全件取得。※クエリに limit / offset を書いてはならない(v1の不具合#3)
  A.fetchAll = async (app, query, fields) => {
    const body = { app: app, size: 500 };
    if (query) body.query = query;
    if (fields) body.fields = fields;
    const cur = await A.call('/k/v1/records/cursor', 'POST', body);
    const out = [];
    try {
      for (;;) {
        const r = await A.call('/k/v1/records/cursor', 'GET', { id: cur.id });
        out.push.apply(out, r.records);
        if (!r.next) break;
      }
    } catch (e) {
      try { await A.call('/k/v1/records/cursor', 'DELETE', { id: cur.id }); } catch (_) {}
      throw e;
    }
    return out;
  };

  // 500件以下想定の簡易取得(order by / limit / offset を使いたい場合)
  A.fetchSome = async (app, query, fields) => {
    const params = { app: app, query: query || '' };
    if (fields) params.fields = fields;
    const r = await A.call('/k/v1/records', 'GET', params);
    return r.records;
  };

  A.chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  A.postOne = async (app, record) => A.call('/k/v1/record', 'POST', { app: app, record: record });
  A.putOne = async (app, id, record) => A.call('/k/v1/record', 'PUT', { app: app, id: id, record: record });
  A.postAll = async (app, records) => {
    const ids = [], revisions = [];
    for (const c of A.chunk(records, 100)) {
      const r = await A.call('/k/v1/records', 'POST', { app: app, records: c });
      ids.push.apply(ids, r.ids); revisions.push.apply(revisions, r.revisions);
    }
    return { ids: ids, revisions: revisions };
  };
  A.putAll = async (app, updates) => {
    const out = [];
    for (const c of A.chunk(updates, 100)) {
      const r = await A.call('/k/v1/records', 'PUT', { app: app, records: c });
      out.push.apply(out, r.records);
    }
    return out;
  };
  // 削除は必ず複数形エンドポイント(v1の不具合#1の回避)
  A.deleteAll = async (app, ids) => {
    for (const c of A.chunk(ids, 100)) {
      await A.call('/k/v1/records', 'DELETE', { app: app, ids: c });
    }
  };

  const formCache = {};
  A.getFormFields = async (app) => {
    if (!formCache[app]) formCache[app] = await A.call('/k/v1/app/form/fields', 'GET', { app: app });
    return formCache[app].properties;
  };
  A.getOptions = async (app, code) => {
    try {
      const p = await A.getFormFields(app);
      const f = p[code];
      if (f && f.options) {
        return Object.values(f.options).sort((a, b) => +a.index - +b.index).map((o) => o.label);
      }
    } catch (e) { console.warn('getOptions failed', app, code, e); }
    return null;
  };

  /* ===================================================================
   * 5. マスタ/設定レコードへのアクセス
   * マスタ/設定レコードは【常にアプリ11】に存在する。
   * アプリ10のパネルから呼ばれても正しくアプリ11を参照する(v1の不具合#5の回避)。
   * =================================================================== */
  let masterAppOverride = null;
  KARTE.setMasterAppId = (id) => { masterAppOverride = id; };
  const mApp = () => masterAppOverride || C.APP11_ID;

  // 支援記録を取得するためのクエリ断片。
  // 【最重要】肯定形(in "支援記録")ではなく否定形にする。
  // アプリ11の既存レコードは「レコード種別」が空のため、否定形にしないと全件除外されてしまう(設計書 §2.3)。
  KARTE.karteQuery = () => F.kind + ' not in ("' + K.sys + '", "' + K.check + '")';

  KARTE.master = {
    async sysRecord(name) {
      const q = F.kind + ' in ("' + K.sys + '") and ' + F.mName + ' = "' + name + '" limit 1';
      const r = await A.fetchSome(mApp(), q);
      return r[0] || null;
    },
    async sysValue(name) {
      const r = await this.sysRecord(name);
      return r ? (r[F.mValue] ? r[F.mValue].value || '' : '') : '';
    },
    async sysJson(name, fallback) {
      const r = await this.sysRecord(name);
      if (!r || !r[F.mJson]) return fallback;
      try { return JSON.parse(r[F.mJson].value || 'null') || fallback; }
      catch (e) { return fallback; }
    },
    async upsertSys(name, valueStr, jsonObj) {
      const rec = {};
      rec[F.kind] = { value: K.sys };
      rec[F.mName] = { value: name };
      if (valueStr != null) rec[F.mValue] = { value: valueStr };
      if (jsonObj != null) rec[F.mJson] = { value: JSON.stringify(jsonObj, null, 1) };
      const cur = await this.sysRecord(name);
      if (cur) await A.putOne(mApp(), cur.$id.value, rec);
      else await A.postOne(mApp(), rec);
    },

    // 手動登録分のみ(年末年始・夏季休業など)
    async customHolidays() {
      const j = await this.sysJson(C.SYS_KEYS.holidays, { holidays: [] });
      return new Set(j.holidays || []);
    },
    // 休業日 = 自動計算した国民の祝日 + 手動登録分
    async holidays() {
      const custom = await this.customHolidays();
      const y = new Date().getFullYear();
      const computed = [y - 1, y, y + 1, y + 2].reduce((acc, yr) => acc.concat(U.japanHolidays(yr)), []);
      return new Set(Array.from(custom).concat(computed));
    },
    async quality() {
      const j = await this.sysJson(C.SYS_KEYS.quality, null);
      return j && j.minChars ? j : C.DEFAULT_QUALITY;
    },
    async cutover() {
      return (await this.sysValue(C.SYS_KEYS.cutover)) || '2000-01-01';
    },

    // チェック月次(対象外マーク)
    async monthly(month) {
      const q = F.kind + ' in ("' + K.check + '") and ' + F.mMonth + ' = "' + month + '" limit 1';
      const r = (await A.fetchSome(mApp(), q))[0];
      if (!r) return { id: null, month: month, data: { excluded: {} } };
      let data = { excluded: {} };
      try { data = JSON.parse(r[F.mJson].value || '{}'); } catch (e) {}
      if (!data.excluded) data.excluded = {};
      return { id: r.$id.value, month: month, data: data };
    },
    async saveMonthly(monthly) {
      const rec = {};
      rec[F.kind] = { value: K.check };
      rec[F.mMonth] = { value: monthly.month };
      rec[F.mJson] = { value: JSON.stringify(monthly.data) };
      if (monthly.id) await A.putOne(mApp(), monthly.id, rec);
      else { const r = await A.postOne(mApp(), rec); monthly.id = r.id; }
    },
  };

  /* ===================================================================
   * 6. アプリ10 児童の取得
   * =================================================================== */
  // 利用状況が「利用中」の児童のみを返す(設計書 §3.3)
  // クエリで絞った上で、クライアント側でも再度絞る(二重の保証)。
  // フィールドコードの変更やクエリの改変で「終結児童が混ざる」事故を防ぐため。
  let childrenCache = null;
  KARTE.fetchChildren = async (force) => {
    if (childrenCache && !force) return childrenCache;
    const a = C.A10;
    const q = a.status + ' in ("' + C.STATUS_ACTIVE + '")';
    const fields = ['$id', a.name, a.kana, a.status, a.office, a.days, a.time, a.stage, a.grade, a.contract];
    const recs = await A.fetchAll(C.APP10_ID, q, fields);
    childrenCache = recs.map((r) => ({
      id: Number(r.$id.value),
      name: r[a.name] ? r[a.name].value || '' : '',
      kana: r[a.kana] ? r[a.kana].value || '' : '',
      status: r[a.status] ? r[a.status].value : '',
      office: r[a.office] ? r[a.office].value : '',
      days: r[a.days] ? r[a.days].value || [] : [],
      time: r[a.time] ? r[a.time].value || '' : '',
      stage: r[a.stage] ? r[a.stage].value || '' : '',
      grade: r[a.grade] ? r[a.grade].value || '' : '',
      contract: r[a.contract] ? r[a.contract].value || '' : '', // 利用開始日として使用
    })).filter((c) => c.status === C.STATUS_ACTIVE);
    return childrenCache;
  };
  KARTE.clearChildrenCache = () => { childrenCache = null; };

  // アプリ10のレコード番号 → 学年
  let gradeMapCache = null;
  KARTE.fetchGradeMap = async () => {
    if (gradeMapCache) return gradeMapCache;
    const map = {};
    try {
      const recs = await A.fetchAll(C.APP10_ID, '', ['$id', C.A10.grade]);
      recs.forEach((r) => { map[Number(r.$id.value)] = r[C.A10.grade] ? r[C.A10.grade].value || '' : ''; });
    } catch (e) { console.warn('学年の取得に失敗', e); }
    gradeMapCache = map;
    return map;
  };

  // ログインユーザー自身の配属(アプリ50)。週間一覧の事業所初期値に使用。
  let myOfficeCache = null;
  KARTE.fetchMyOffice = async () => {
    if (myOfficeCache !== null) return myOfficeCache;
    let office = '';
    try {
      const q = C.A50.name + ' in (LOGINUSER()) limit 1';
      const recs = await A.fetchSome(C.APP50_ID, q, [C.A50.dept]);
      if (recs[0] && recs[0][C.A50.dept]) office = recs[0][C.A50.dept].value || '';
    } catch (e) { console.warn('配属の取得に失敗', e); }
    myOfficeCache = office;
    return office;
  };

  /* ===================================================================
   * 7. 入力補助の候補(過去の実績から動的に集計。候補マスタは持たない)
   * 設計書 §4.2b
   * =================================================================== */
  KARTE.fetchSuggest = async () => {
    const key = 'karte.v2.suggest.' + C.APP11_ID;
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (cached && Date.now() - cached.ts < 3600 * 1000) return cached.data;
    } catch (e) {}
    const since = U.addDays(U.todayStr(), -C.SUGGEST_DAYS);
    const q = KARTE.karteQuery() + ' and ' + F.date + ' >= "' + since + '"';
    const acts = {}, aims = {};
    try {
      const recs = await A.fetchAll(C.APP11_ID, q, [F.table]);
      recs.forEach((r) => {
        ((r[F.table] && r[F.table].value) || []).forEach((row) => {
          const a = (row.value[F.tAct] ? row.value[F.tAct].value || '' : '').trim();
          const n = (row.value[F.tAim] ? row.value[F.tAim].value || '' : '').trim();
          if (a) acts[a] = (acts[a] || 0) + 1;
          if (n) aims[n] = (aims[n] || 0) + 1;
        });
      });
    } catch (e) { console.warn('入力補助の候補集計に失敗', e); }
    const top = (obj) => Object.keys(obj).sort((x, y) => obj[y] - obj[x]).slice(0, C.SUGGEST_MAX);
    const data = { acts: top(acts), aims: top(aims) };
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) {}
    return data;
  };

  /* ===================================================================
   * 8. バリデーション
   * 1活動 = 1ねらい = 1手立て。小目標の概念は無い(設計書 §5.2)
   * =================================================================== */
  // data = { attend, absentReason, rows: [{act, aim, tate, eval}] }
  // opt  = { legacy, quality }
  KARTE.validateData = (data, opt) => {
    const errors = [], warns = [];
    const q = (opt && opt.quality) || C.DEFAULT_QUALITY;
    const legacy = !!(opt && opt.legacy);

    // 出欠区分が空の既存レコードは「出席」として扱う(設計書 §2.3)
    const attend = data.attend || C.ATTEND.present;

    if (C.ABSENT_STATUSES.indexOf(attend) >= 0) {
      if (!String(data.absentReason || '').trim()) errors.push('欠席理由が未選択');
      return { errors: errors, warns: warns };
    }
    if (!data.rows || data.rows.length === 0) {
      errors.push('活動明細が0行');
      return { errors: errors, warns: warns };
    }
    data.rows.forEach((r, i) => {
      const n = i + 1;
      const miss = [];
      if (!String(r.act || '').trim()) miss.push('活動');
      if (!String(r.aim || '').trim()) miss.push('ねらい');
      if (!String(r.tate || '').trim()) miss.push('方法');
      if (!String(r.eval || '').trim()) miss.push('評価');
      if (miss.length) errors.push(n + '行目: ' + miss.join('・') + ' 未入力');
      if (!legacy) {
        const t = String(r.tate || '').trim();
        if (t && t.length < q.minChars && t.split('\n').filter((x) => x.trim()).length < q.minLines) {
          warns.push(n + '行目: 方法が目安未満(' + q.minChars + '字または' + q.minLines + '行以上を推奨)');
        }
      }
    });
    return { errors: errors, warns: warns };
  };

  KARTE.recordToData = (rec) => ({
    attend: rec[F.attend] ? rec[F.attend].value : '',
    absentReason: rec[F.absentReason] ? rec[F.absentReason].value || '' : '',
    rows: ((rec[F.table] && rec[F.table].value) || []).map((row) => ({
      act: row.value[F.tAct] ? row.value[F.tAct].value || '' : '',
      aim: row.value[F.tAim] ? row.value[F.tAim].value || '' : '',
      tate: row.value[F.tTate] ? row.value[F.tTate].value || '' : '',
      eval: row.value[F.tEval] ? row.value[F.tEval].value || '' : '',
      comment: row.value[F.tComment] ? row.value[F.tComment].value || '' : '',
    })),
  });

  /* ===================================================================
   * 9. 作成チェック 共通エンジン
   * 「✅作成チェック」「🗓週間一覧」「アプリ10の出欠カレンダー」の3画面が
   * 同一の判定・同一のポップアップを使うため、最初から共通モジュールとして実装する。
   * 設計書 §5.1
   * =================================================================== */
  const CE = (KARTE.checkEngine = {});

  CE.STATUS = {
    done:     { icon: '✅', label: '完了',        cls: 'ck-done',  order: 6 },
    warn:     { icon: '🟡', label: '注意',        cls: 'ck-warn',  order: 3 },
    lack:     { icon: '⚠️', label: '不備',        cls: 'ck-lack',  order: 1 },
    none:     { icon: '❌', label: '未作成',      cls: 'ck-none',  order: 0 },
    dup:      { icon: '🔁', label: '重複',        cls: 'ck-dup',   order: 2 },
    absPre:   { icon: '🏠', label: '事前欠席',    cls: 'ck-abs',   order: 7 },
    absDay:   { icon: '🏠', label: '直近欠席',    cls: 'ck-abs',   order: 7 },
    absLack:  { icon: '⚠️', label: '欠席理由なし', cls: 'ck-lack',  order: 1 },
    extra:    { icon: 'ℹ️', label: '予定外',      cls: 'ck-extra', order: 8 },
    excluded: { icon: '➖', label: '対象外',      cls: 'ck-excl',  order: 9 },
  };
  // 欠席への変更を提示する状態(重複は先に重複解消が必要なので対象外)
  CE.ABSENCE_TARGETS = ['none', 'lack', 'warn', 'absLack', 'extra'];
  // 対象外にできる状態
  CE.EXCLUDE_TARGETS = ['none', 'lack', 'extra', 'dup', 'absLack'];
  // 問題として数える状態
  CE.PROBLEM_STATUSES = ['none', 'lack', 'dup', 'absLack'];

  CE.slotKey = (childId, date, timeHM) => childId + '|' + date + '|' + timeHM;

  // 氏名 → アプリ10レコード番号 の索引。同姓同名も検出する。
  CE.buildNameIndex = (children) => {
    const byName = {}, dup = {};
    (children || []).forEach((c) => {
      const k = U.normName(c.name);
      if (!k) return;
      if (byName[k] == null) byName[k] = c.id;
      else dup[k] = true;
    });
    return { byName: byName, duplicateNames: Object.keys(dup) };
  };

  function inService(c, dateStr) {
    // アプリ10の契約日を利用開始日として使う(設計書 §2.5)
    if (c.contract && dateStr < c.contract) return false;
    return true; // fetchChildrenが利用中のみを返すため、状態チェックは不要
  }

  // opts = { children, holidays, office, dates }
  CE.buildExpectedSlots = (opts) => {
    const slots = [];
    const holidays = opts.holidays;
    (opts.children || []).forEach((c) => {
      if (opts.office && c.office !== opts.office) return;
      (opts.dates || []).forEach((dateStr) => {
        if (holidays && holidays.has(dateStr)) return;
        if (!inService(c, dateStr)) return;
        if (c.days.indexOf(U.weekdayJa(dateStr)) < 0) return;
        slots.push({
          childId: c.id, name: c.name, kana: c.kana, office: c.office,
          stage: c.stage, grade: c.grade, date: dateStr, time: U.normHM(c.time),
        });
      });
    });
    return slots;
  };

  // 対象期間に含まれる全ての月の「チェック月次」をまとめて取得(週が月をまたぐ場合に対応)
  CE.loadExcludedMap = async (dates) => {
    const months = Array.from(new Set((dates || []).map((d) => U.monthOf(d))));
    const monthlies = {};
    await Promise.all(months.map(async (mo) => { monthlies[mo] = await KARTE.master.monthly(mo); }));
    const excludedMap = {};
    months.forEach((mo) => {
      const ex = monthlies[mo].data.excluded || {};
      Object.keys(ex).forEach((k) => { excludedMap[k] = ex[k]; });
    });
    return { excludedMap: excludedMap, monthlies: monthlies };
  };

  // opts = { records, slots, excludedMap, cutover, quality, office, nameIndex }
  // 戻り値 = { results, unresolvedCount, duplicateNames }
  CE.evaluate = (opts) => {
    const records = opts.records || [], slots = opts.slots || [];
    const excludedMap = opts.excludedMap || {}, office = opts.office;
    const nameIndex = opts.nameIndex || { byName: {}, duplicateNames: [] };

    // レコードを 児童|日|時刻 でグルーピング
    const recMap = {};
    let unresolved = 0;
    records.forEach((r) => {
      const nm = U.normName(r[F.name] ? r[F.name].value : '');
      const cid = nameIndex.byName[nm];
      if (cid == null) { unresolved++; return; } // アプリ10に該当児童なし(終結済み等)
      const key = CE.slotKey(cid, r[F.date].value, U.normHM(r[F.time].value));
      (recMap[key] = recMap[key] || []).push(r);
      r.__childId = cid;
    });

    const results = [], usedKeys = {};

    slots.forEach((s) => {
      const key = CE.slotKey(s.childId, s.date, s.time);
      usedKeys[key] = true;
      const recs = recMap[key] || [];
      const base = {
        childId: s.childId, name: s.name, kana: s.kana, office: s.office,
        stage: s.stage, grade: s.grade, date: s.date, time: s.time,
      };

      const excl = excludedMap[key];
      if (excl) {
        results.push(Object.assign(base, {
          status: 'excluded', detail: excl.reason || '',
          recordId: recs[0] ? recs[0].$id.value : null,
        }));
        return;
      }
      if (recs.length === 0) { results.push(Object.assign(base, { status: 'none', detail: '' })); return; }
      if (recs.length >= 2) {
        results.push(Object.assign(base, {
          status: 'dup', detail: recs.length + '件のレコード',
          recordId: recs[0].$id.value, dupIds: recs.map((r) => r.$id.value),
        }));
        return;
      }

      const r = recs[0], rid = r.$id.value;
      const attend = (r[F.attend] ? r[F.attend].value : '') || C.ATTEND.present;

      if (C.ABSENT_STATUSES.indexOf(attend) >= 0) {
        const reason = r[F.absentReason] ? r[F.absentReason].value || '' : '';
        if (!reason.trim()) {
          results.push(Object.assign(base, { status: 'absLack', detail: '欠席理由が未選択', recordId: rid }));
        } else {
          results.push(Object.assign(base, {
            status: attend === C.ATTEND.absentPre ? 'absPre' : 'absDay', detail: '', recordId: rid,
          }));
        }
        return;
      }

      // チェック基準適用開始日より前のレコードは緩和判定(既存の数年分が一斉に不備になるのを防ぐ)
      const legacy = r[F.date].value < opts.cutover;
      const v = KARTE.validateData(KARTE.recordToData(r), { legacy: legacy, quality: opts.quality });
      if (v.errors.length) {
        results.push(Object.assign(base, { status: 'lack', detail: v.errors.join(' / '), recordId: rid }));
      } else if (v.warns.length) {
        results.push(Object.assign(base, { status: 'warn', detail: v.warns.join(' / '), recordId: rid }));
      } else {
        results.push(Object.assign(base, { status: 'done', detail: '', recordId: rid }));
      }
    });

    // 予定に対応しないレコード(振替等) = 予定外
    Object.keys(recMap).forEach((key) => {
      if (usedKeys[key]) return;
      const recs = recMap[key];
      recs.forEach((r, i) => {
        const base = {
          childId: r.__childId,
          name: r[F.name] ? r[F.name].value || '' : '',
          kana: r[F.kana] ? r[F.kana].value || '' : '',
          office: r[F.office] ? r[F.office].value || '' : '',
          date: r[F.date].value, time: U.normHM(r[F.time].value),
          recordId: r.$id.value,
        };
        if (office && base.office !== office) return;
        if (recs.length >= 2 && i === 0) {
          results.push(Object.assign({}, base, {
            status: 'dup', detail: recs.length + '件(予定外)', dupIds: recs.map((x) => x.$id.value),
          }));
        } else if (recs.length < 2) {
          const attend = (r[F.attend] ? r[F.attend].value : '') || C.ATTEND.present;
          const isAbs = C.ABSENT_STATUSES.indexOf(attend) >= 0;
          results.push(Object.assign({}, base, {
            status: 'extra', detail: isAbs ? '予定外の欠席記録' : '予定にない出席記録(振替等)',
          }));
        }
      });
    });

    return { results: results, unresolvedCount: unresolved, duplicateNames: nameIndex.duplicateNames };
  };

  /* ---- 遷移 ---- */
  CE.openRecord = (recordId) => {
    if (!recordId) return;
    location.href = location.origin + '/k/' + C.APP11_ID + '/show#record=' + recordId;
  };
  CE.openRecordEdit = (recordId, newTab) => {
    if (!recordId) return;
    const url = location.origin + '/k/' + C.APP11_ID + '/show#record=' + recordId + '&mode=edit';
    if (newTab) window.open(url, '_blank'); else location.href = url;
  };
  CE.openApp10 = (childId) => {
    window.open(location.origin + '/k/' + C.APP10_ID + '/show#record=' + childId, '_blank');
  };

  /* ---- モーダル ---- */
  let modalEl = null, modalOnClose = null;
  CE.showModal = (content, onClose) => {
    CE.closeModal();
    modalOnClose = onClose || null;
    modalEl = h('div', { class: 'ck-modal', onclick: (e) => { if (e.target === modalEl) CE.closeModal(); } },
      h('div', { class: 'ck-modal-inner' },
        h('button', { class: 'ck-modal-close', onclick: CE.closeModal }, '×'),
        content));
    document.body.appendChild(modalEl);
  };
  CE.closeModal = () => {
    if (modalEl) { modalEl.remove(); modalEl = null; }
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
  };

  // 欠席理由を定型から選ばせる。キャンセル時は null。
  // 【重要】Promiseの解決を先に、モーダルを閉じるのを後に行う。
  // 逆順にすると closeModal 内の onClose(null) が選択結果を上書きしてしまう(v1の不具合#4)。
  CE.pickAbsentReason = (attendLabel) => {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const list = h('div', { class: 'ck-reason-list' });
      C.ABSENT_REASONS.forEach((rs) => {
        list.appendChild(h('button', { class: 'ck-reason-btn', onclick: () => { done(rs); CE.closeModal(); } }, rs));
      });
      const box = h('div', { class: 'ck-modal-body' },
        h('div', { class: 'ck-modal-head' }, '「' + attendLabel + '」の理由を選択'),
        h('div', { class: 'karte-hint' }, '定型文をタップしてください。'),
        list,
        h('div', { class: 'ck-modal-actions' },
          h('button', { class: 'karte-btn karte-btn-ghost', onclick: () => { done(null); CE.closeModal(); } }, 'キャンセル')));
      CE.showModal(box, () => done(null));
    });
  };

  /* ---- 骨組みレコードの作成(未作成 → すぐ編集画面へ) ---- */
  // kintoneの標準の新規作成画面にURLで初期値を渡せないため、
  // APIで日付・時刻・児童等を入れたレコードを作り、その編集画面を開く(設計書 §3.3 / J4)
  CE.createSkeleton = async (r, env) => {
    const child = ((env && env.children) || []).filter((c) => c.id === r.childId)[0] || {};
    const rec = {};
    rec[F.kind] = { value: K.record };
    rec[F.date] = { value: r.date };
    rec[F.time] = { value: r.time };
    rec[F.office] = { value: r.office || child.office || '' };
    rec[F.name] = { value: r.name || child.name || '' };       // ルックアップのキー
    rec[F.kana] = { value: r.kana || child.kana || '' };       // ルックアップの取得は走らないため明示的に入れる
    rec[F.stage] = { value: r.stage || child.stage || '' };
    rec[F.attend] = { value: C.ATTEND.present };
    try {
      const res = await A.postOne(C.APP11_ID, rec);
      return res.id;
    } catch (e) {
      console.error(e);
      alert('レコードの作成に失敗しました: ' + (e.message || JSON.stringify(e)));
      return null;
    }
  };

  /* ---- 欠席として記録する ---- */
  CE.setAbsence = async (r, attendValue, env) => {
    if (r.status === 'dup') {
      alert('このスロットは重複しています。先に重複を解消してから欠席に変更してください。');
      return false;
    }
    const reason = await CE.pickAbsentReason(attendValue);
    if (!reason) return false;
    try {
      if (r.recordId) {
        const rec = {};
        rec[F.attend] = { value: attendValue };
        rec[F.absentReason] = { value: reason };
        rec[F.table] = { value: [] }; // 欠席なので活動明細はクリア
        await A.putOne(C.APP11_ID, r.recordId, rec);
      } else {
        const child = ((env && env.children) || []).filter((c) => c.id === r.childId)[0] || {};
        const rec = {};
        rec[F.kind] = { value: K.record };
        rec[F.date] = { value: r.date };
        rec[F.time] = { value: r.time };
        rec[F.office] = { value: r.office || child.office || '' };
        rec[F.name] = { value: r.name || child.name || '' };
        rec[F.kana] = { value: r.kana || child.kana || '' };
        rec[F.stage] = { value: r.stage || child.stage || '' };
        rec[F.attend] = { value: attendValue };
        rec[F.absentReason] = { value: reason };
        rec[F.table] = { value: [] };
        await A.postOne(C.APP11_ID, rec);
      }
      return true;
    } catch (e) {
      console.error(e);
      alert('保存に失敗しました: ' + (e.message || JSON.stringify(e)));
      return false;
    }
  };

  /* ---- 対象外マーク ---- */
  async function markExcluded(r, env) {
    const reason = prompt(
      '対象外にする理由を入力してください。\n' +
      '(欠席の場合は「対象外」ではなく欠席として記録してください)\n\n' +
      r.name + ' ' + r.date + '(' + U.weekdayJa(r.date) + ') ' + r.time, '');
    if (reason === null) return false;
    if (!String(reason).trim()) { alert('理由は必須です。'); return false; }
    const month = U.monthOf(r.date);
    const monthlies = (env && env.monthlies) || {};
    const monthly = (monthlies[month] = monthlies[month] || await KARTE.master.monthly(month));
    monthly.data.excluded = monthly.data.excluded || {};
    monthly.data.excluded[CE.slotKey(r.childId, r.date, r.time)] = {
      reason: reason, by: kintone.getLoginUser().code, at: U.todayStr(),
    };
    try { await KARTE.master.saveMonthly(monthly); return true; }
    catch (e) { alert('保存に失敗: ' + (e.message || e)); return false; }
  }
  async function unmarkExcluded(r, env) {
    const month = U.monthOf(r.date);
    const monthlies = (env && env.monthlies) || {};
    const monthly = (monthlies[month] = monthlies[month] || await KARTE.master.monthly(month));
    if (monthly.data.excluded) delete monthly.data.excluded[CE.slotKey(r.childId, r.date, r.time)];
    try { await KARTE.master.saveMonthly(monthly); return true; }
    catch (e) { alert('保存に失敗: ' + (e.message || e)); return false; }
  }
  CE.markExcluded = markExcluded;
  CE.unmarkExcluded = unmarkExcluded;

  /* ---- 詳細ポップアップ(3画面で共用) ----
   * env = { children, monthlies, onChanged }
   *   onChanged: 保存を伴う操作の後に呼ばれる(呼び出し側で再読み込みする)
   */
  CE.openDetail = (r, env) => {
    env = env || {};
    const ST = CE.STATUS, st = ST[r.status];
    const box = h('div', { class: 'ck-modal-body' },
      h('div', { class: 'ck-modal-head' },
        h('span', { class: 'ck-badge ' + st.cls }, st.icon + ' ' + st.label), ' ', r.name),
      h('div', { class: 'ck-modal-line' },
        r.date + '(' + U.weekdayJa(r.date) + ') ' + r.time + (r.office ? ' / ' + r.office : '')),
      r.detail ? h('div', { class: 'ck-modal-detail' }, r.detail) : null);

    const actions = h('div', { class: 'ck-modal-actions' });
    const fireChanged = () => { if (env.onChanged) env.onChanged(); };

    if (r.status === 'excluded') {
      box.appendChild(h('div', { class: 'ck-guide' },
        h('p', null, 'このスロットは対象外としてマークされています。完了率の計算からも除かれています。')));
      actions.appendChild(h('button', {
        class: 'karte-btn',
        onclick: async () => { CE.closeModal(); if (await unmarkExcluded(r, env)) fireChanged(); },
      }, '↩ 対象外を解除する'));
      if (r.recordId) {
        actions.appendChild(h('button', { class: 'karte-btn karte-btn-ghost', onclick: () => { CE.openRecordEdit(r.recordId); } }, '📝 レコードを開く'));
      }
    } else {
      // 開く / 作成
      if (r.recordId) {
        actions.appendChild(h('button', {
          class: 'karte-btn karte-btn-primary',
          onclick: () => { CE.openRecordEdit(r.recordId); },
        }, '📝 開く'));
      } else {
        actions.appendChild(h('button', {
          class: 'karte-btn karte-btn-primary',
          onclick: async () => {
            const btnBox = box.querySelector('.ck-modal-actions');
            if (btnBox) btnBox.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            const id = await CE.createSkeleton(r, env);
            if (id) CE.openRecordEdit(id);
            else if (btnBox) btnBox.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          },
        }, '📝 作成して開く'));
      }

      if (CE.ABSENCE_TARGETS.indexOf(r.status) >= 0 || CE.EXCLUDE_TARGETS.indexOf(r.status) >= 0) {
        box.appendChild(h('div', { class: 'ck-guide' },
          h('p', null, h('b', null, '① まず欠席かどうかを確認してください。'), ' 欠席なら下のボタンでその場で記録できます。'),
          h('p', null, h('b', null, '② 欠席でもない場合'), 'は、アプリ10「利用者リスト」の',
            h('b', null, '利用曜日・主な利用時間・利用状況・契約日'), 'が実態と合っていない可能性があります。まずそちらを修正してください。'),
          h('p', { class: 'ck-guide-note' }, '「対象外」は、欠席でもなく予定の修正でもない例外的なケースにのみ使用します。')));
      }
      if (CE.ABSENCE_TARGETS.indexOf(r.status) >= 0) {
        actions.appendChild(h('button', {
          class: 'karte-btn karte-btn-abspre',
          onclick: async () => { CE.closeModal(); if (await CE.setAbsence(r, C.ATTEND.absentPre, env)) fireChanged(); },
        }, '🏠 事前欠席にする'));
        actions.appendChild(h('button', {
          class: 'karte-btn karte-btn-absday',
          onclick: async () => { CE.closeModal(); if (await CE.setAbsence(r, C.ATTEND.absentDay, env)) fireChanged(); },
        }, '🏠 直近欠席にする'));
      }
      if (CE.EXCLUDE_TARGETS.indexOf(r.status) >= 0) {
        actions.appendChild(h('button', {
          class: 'karte-btn karte-btn-ghost',
          onclick: () => { CE.closeModal(); CE.openApp10(r.childId); },
        }, '👤 利用者リストを確認'));
        actions.appendChild(h('button', {
          class: 'karte-btn karte-btn-ghost',
          onclick: async () => { CE.closeModal(); if (await markExcluded(r, env)) fireChanged(); },
        }, '➖ それでも対象外にする'));
      }
    }
    box.appendChild(actions);
    CE.showModal(box);
  };
})();
