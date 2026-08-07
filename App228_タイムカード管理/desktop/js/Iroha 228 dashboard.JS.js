/* =========================================================================
   支援計画 進捗ダッシュボード（アプリ228 カスタムビュー用）
   -------------------------------------------------------------------------
   ・利用中児童の支援計画PDF保存進捗を年度(4月〜3月)×事業所別に表示。
   ・年度切替ボタン付き。当月タブがデフォルト選択。
   ・事業所別 + 全件一括のPDF保存（ZIP）。
   ・通所先が「訪問のみ」の児童は非表示。
   ・児童名クリックでアプリ10のレコード詳細へ遷移。
   -------------------------------------------------------------------------
   【今回の改修点】
   ・年度内のどの月（過去・当月・前月・未来）でも同一ロジックで
     計画✅／懇談✅／フォルダ保存ボタン等をすべて表示するようにした
     （旧版にあった「前月・当月・来月のみフル表示、それ以外は簡易表示」
       という制限＝isPCN判定を撤廃）。特別扱いは「来月は懇談を
       表示しない」の1点のみ。
   ・アプリ10「契約日」を含む月より前は、その児童の行を一切生成しない
     （契約日以降のみ表示）ロジックを新規追加した。
   -------------------------------------------------------------------------
   【今回のバグ修正】
   ・新規利用開始（契約）から間もない児童で、初回の期間が「後期」から
     始まり、かつ短縮された変則的な期間になる場合、次の「前期」の
     計画完了判定（前期案＋直前の後期評価案の両方が必要）が、
     「6か月前ちょうど」の日付でしか後期レコードを探していなかった
     ため、変則的な初回期間（後期開始日が標準の6か月前からズレて
     いるケース）では直前の後期評価案が見つからず、前期案が保存
     済みでも✅が付かない不具合があった。
     → findNewUserRecs にフォールバック（前期/後期どちらかの開始日
       しか入っていない同一レコードも対象にする）を追加。
     → 前期の完了判定に、
       ①同一レコード自身に後期評価案が入っていないか
       ②それでも無ければ、対象月より前で直近の後期計画開始日を持つ
         レコード
       の2段階フォールバックを追加した。
   ========================================================================= */
(function () {
  'use strict';

  const D = {
    APP_JIDOU:   10,
    APP_KEIKAKU: 207,
    CONTAINER_ID: 'iroha-228-dashboard',
    J_NAME:     '児童氏名',
    J_KANA:     '児童フリガナ',
    J_PLAN:     '支援計画',
    J_TANTOU:   '担当',
    J_STATUS:   '利用状況',
    J_BIRTH:    '誕生日',
    J_CONTRACT: '契約日',
    J_SOUDAN:   '計画相談事業所',
    J_TSUUSHO:  '通所先',
    STATUS_ACTIVE: '利用中',
    EXCLUDE_TSUUSHO: '訪問のみ',

    K_NAME:              '氏名',
    K_BIRTH:             '生年月日',
    K_ZENKI_START:       '前期計画開始',
    K_KOUKI_START:       '後期計画開始',
    K_ZENKI_PLAN:        '前期案',
    K_ZENKI_EVAL:        '前期評価案',
    K_KOUKI_PLAN:        '後期案',
    K_KOUKI_EVAL:        '後期評価案',
    K_ZENKI_SIGNED:      '前期サイン済',
    K_ZENKI_EVAL_SIGNED: '前期評価サイン済',
    K_KOUKI_SIGNED:      '後期サイン済',
    K_KOUKI_EVAL_SIGNED: '後期評価サイン済',
  };

  const KEIKAKU_REQUIRE_EVAL = true;
  const UPDATE_INTERVAL = 6;
  const KINTONE_BASE = 'https://' + location.hostname;

  let dashRendered = false;
  let selectedMonthIdx = null;
  let selectedFiscalYear = null;
  let cachedData = null;

  /* ===== JSZip CDN（File System Access API非対応ブラウザ用フォールバック）===== */
  async function loadJSZip() {
    if (typeof JSZip !== 'undefined') return;
    await new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve; s.onerror = function() { reject(new Error('JSZip読込失敗')); };
      document.head.appendChild(s);
    });
  }

  /* ===== File System Access API：フォルダハンドルの記憶（IndexedDB）=====
     事業所ごとに「保存先フォルダ」を個別に記憶します。
     ブラウザの対応：Chrome / Edge / Brave（Chromium系）。Safari/Firefoxは未対応。 */
  const FS_SUPPORTED = (typeof window.showDirectoryPicker === 'function');
  const FS_DB_NAME = 'iroha228FolderDB';
  const FS_STORE_NAME = 'folders';

  function fsOpenDB() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(FS_DB_NAME, 1);
      req.onupgradeneeded = function() {
        req.result.createObjectStore(FS_STORE_NAME);
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }
  async function fsGetHandle(key) {
    var db = await fsOpenDB();
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(FS_STORE_NAME, 'readonly');
      var req = tx.objectStore(FS_STORE_NAME).get(key);
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { reject(req.error); };
    });
  }
  async function fsSetHandle(key, handle) {
    var db = await fsOpenDB();
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(FS_STORE_NAME, 'readwrite');
      tx.objectStore(FS_STORE_NAME).put(handle, key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  }
  /* 事業所名から記憶キーを生成（事業所ごとに別フォルダを割り当てられるようにする）*/
  function fsKeyForGroup(soudanName) {
    return 'soudan:' + (soudanName || '__未設定__');
  }

  /* ===== 事業所ごとの「保存対象外」設定（localStorage）=====
     一度「対象外」にした事業所は、個別保存ボタン・全事業所一括保存の
     どちらからも除外されます。カード上の「対象外にする/対象に戻す」
     リンクでいつでも切り替えられます。 */
  const EXCLUDE_LS_KEY = 'iroha228ExcludedSoudan';
  function getExcludedSoudanSet() {
    try {
      var raw = localStorage.getItem(EXCLUDE_LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) { return new Set(); }
  }
  function isSoudanExcluded(soudanName) {
    var key = fsKeyForGroup(soudanName);
    return getExcludedSoudanSet().has(key);
  }
  function setSoudanExcluded(soudanName, excluded) {
    var key = fsKeyForGroup(soudanName);
    var set = getExcludedSoudanSet();
    if (excluded) set.add(key); else set.delete(key);
    try {
      localStorage.setItem(EXCLUDE_LS_KEY, JSON.stringify(Array.from(set)));
    } catch (e) { console.error('[228] 除外設定の保存に失敗:', e); }
  }

  /* 権限が失効していないか確認し、必要なら再許可を求める */
  async function fsEnsurePermission(handle) {
    if (!handle) return false;
    try {
      var opts = { mode: 'readwrite' };
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      if ((await handle.requestPermission(opts)) === 'granted') return true;
      return false;
    } catch (e) {
      return false;
    }
  }
  /* 事業所に紐づくフォルダを取得。記憶が無ければ選択ダイアログを表示して記憶する */
  async function fsGetOrPickFolder(soudanName, forcePick) {
    var key = fsKeyForGroup(soudanName);
    if (!forcePick) {
      var saved = await fsGetHandle(key);
      if (saved && await fsEnsurePermission(saved)) return saved;
    }
    var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await fsSetHandle(key, handle);
    return handle;
  }

  /* ===== ユーティリティ ===== */
  async function dashFetchAll(app, baseQuery) {
    var all = [], offset = 0;
    while (true) {
      var resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: app, query: baseQuery + ' limit 500 offset ' + offset });
      all = all.concat(resp.records);
      if (resp.records.length < 500) break;
      offset += 500; if (offset > 9500) break;
    }
    return all;
  }
  function shiftMonths(y, m, d) { var i = y * 12 + (m - 1) + d; return { year: Math.floor(i / 12), month: (i % 12) + 1 }; }
  function firstDateStr(y, m) { return y + '-' + String(m).padStart(2, '0') + '-01'; }
  function parsePlanMonths(s) {
    if (!s) return null;
    var mm = String(s).match(/(\d{1,2})\s*月/g);
    if (!mm || mm.length < 2) return null;
    var nums = mm.map(function(x) { return parseInt(x, 10); }).filter(function(n) { return n >= 1 && n <= 12; });
    return nums.length >= 2 ? [nums[0], nums[1]] : null;
  }
  function hasFile(r, fc) { if (!r) return false; var f = r[fc]; return !!(f && f.value && Array.isArray(f.value) && f.value.length > 0); }
  function hasFileAny(rs, fc) { return rs && rs.some(function(r) { return hasFile(r, fc); }); }
  function getFileInfos(r, fc) {
    if (!r) return []; var f = r[fc];
    if (!f || !f.value || !Array.isArray(f.value)) return [];
    return f.value.map(function(fi) { return { fileKey: fi.fileKey, name: fi.name }; });
  }
  function escapeQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function isFirstUpdate(cd, tY, tM) {
    if (!cd) return false; var p = String(cd).split('-');
    var cy = parseInt(p[0],10), cm = parseInt(p[1],10);
    if (isNaN(cy)||isNaN(cm)) return false;
    return (cy*12+(cm-1)) >= (tY*12+(tM-1)-(UPDATE_INTERVAL-1)) && (cy*12+(cm-1)) <= (tY*12+(tM-1));
  }
  function normalizeSoudan(raw) {
    if (raw == null || raw === '') return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) return raw.map(function(v) { return v && (typeof v==='object' ? (v.name||v.code||'') : String(v)); }).filter(Boolean).join(',').trim();
    if (typeof raw === 'object') return (raw.name||raw.code||raw.label||'').trim();
    return String(raw).trim();
  }
  function getTantouName(t) {
    if (Array.isArray(t) && t.length) return t.map(function(u) { return u.name || u.code || ''; }).join(', ');
    return typeof t === 'string' ? t : '';
  }
  function getCurrentFiscalYear() { var n = new Date(); return n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; }
  function getFiscalMonths(fy) {
    var ms = [];
    for (var m = 4; m <= 12; m++) ms.push({ year: fy, month: m });
    for (var m2 = 1; m2 <= 3; m2++) ms.push({ year: fy + 1, month: m2 });
    return ms;
  }

  /* ===== アイコンヘルパー ===== */
  function iconDone() { return '<span class="d228-icon-done">✅</span>'; }
  function iconPending() { return '<span class="d228-icon-pending"></span>'; }
  function iconNew() { return '<span class="d228-new-label">NEW</span>'; }

  /* ===== 207レコードマップ ===== */
  function buildMaps(records207) {
    var zM={}, kM={}, aP={};
    records207.forEach(function(r) {
      var nm=r[D.K_NAME]?r[D.K_NAME].value||'':'';
      var bd=r[D.K_BIRTH]?r[D.K_BIRTH].value||'':'';
      var zs=r[D.K_ZENKI_START]?r[D.K_ZENKI_START].value||'':'';
      var ks=r[D.K_KOUKI_START]?r[D.K_KOUKI_START].value||'':'';
      if(zs){var k=nm+'|'+bd+'|'+zs;if(!zM[k])zM[k]=[];zM[k].push(r);}
      if(ks){var k2=nm+'|'+bd+'|'+ks;if(!kM[k2])kM[k2]=[];kM[k2].push(r);}
      var pk=nm+'|'+bd;if(!aP[pk])aP[pk]=[];aP[pk].push(r);
    });
    return{zenkiMultiMap:zM,koukiMultiMap:kM,allByPerson:aP};
  }
  function findNewUserRecs(nm,bd,tY,tM,type,maps){
    var rs=maps.allByPerson[nm+'|'+bd];if(!rs||!rs.length)return[];
    var ti=tY*12+(tM-1),sf=(type==='zenki')?D.K_ZENKI_START:D.K_KOUKI_START,found=[];
    rs.forEach(function(r){var sv=r[sf]?r[sf].value||'':'';if(!sv)return;var p=sv.split('-');
      var ri=parseInt(p[0],10)*12+(parseInt(p[1],10)-1);if(Math.abs(ti-ri)<=UPDATE_INTERVAL)found.push(r);});
    /* フォールバック：変則的な初回レコードで、前期/後期どちらか一方の
       開始日しか入力されていない場合にも対象レコードを拾えるようにする。
       （例：後期計画開始しか入っていないが、実は前期案もそのレコードに
       保存されているケース） */
    if (found.length === 0) {
      var altSf = (type === 'zenki') ? D.K_KOUKI_START : D.K_ZENKI_START;
      rs.forEach(function(r) {
        if (r[sf] && r[sf].value) return; // 対象開始日が入っているものは上のループで判定済み
        var av = r[altSf] ? r[altSf].value || '' : '';
        if (!av) return;
        var p = av.split('-');
        var ai = parseInt(p[0], 10) * 12 + (parseInt(p[1], 10) - 1);
        if (Math.abs(ti - ai) <= UPDATE_INTERVAL) found.push(r);
      });
    }
    return found;
  }
  function findNewUserRecsOld_unused(){} // (placeholder removed - kept for diff clarity, not used)
  function findClosestPriorKouki(nm, bd, tY, tM, maps) {
    var rs = maps.allByPerson[nm + '|' + bd];
    if (!rs || !rs.length) return null;
    var tIdx = tY * 12 + (tM - 1);
    var best = null, bestIdx = -Infinity;
    rs.forEach(function(r) {
      var ks = r[D.K_KOUKI_START] ? r[D.K_KOUKI_START].value || '' : '';
      if (!ks) return;
      var p = ks.split('-');
      var kIdx = parseInt(p[0], 10) * 12 + (parseInt(p[1], 10) - 1);
      if (kIdx < tIdx && kIdx > bestIdx) { bestIdx = kIdx; best = r; }
    });
    return best;
  }

  /* ===== 全月データ構築 =====
     過去月・当月・前月・未来月のいずれも同一ロジックで計画・懇談を判定する。
     特別扱いは「来月は懇談を表示しない」の1点のみ。
     契約日を含む月より前は、その児童の行を一切生成しない。 */
  function buildAllMonthData(jidouRecords, months, maps, baseYear, baseMonth) {
    var monthData = months.map(function() { return { items: [], errorNames: [] }; });
    jidouRecords.forEach(function(child) {
      var name = child[D.J_NAME] ? child[D.J_NAME].value || '' : '';
      var kana = child[D.J_KANA] ? child[D.J_KANA].value || '' : '';
      var planStr = child[D.J_PLAN] ? child[D.J_PLAN].value || '' : '';
      var birth = child[D.J_BIRTH] ? child[D.J_BIRTH].value || '' : '';
      var contractDate = child[D.J_CONTRACT] ? child[D.J_CONTRACT].value || '' : '';
      var soudan = normalizeSoudan(child[D.J_SOUDAN] ? child[D.J_SOUDAN].value : '');
      var tantou = getTantouName(child[D.J_TANTOU] ? child[D.J_TANTOU].value : '');
      var recId = child.$id ? child.$id.value : '';
      if (!name) return;

      // 担当者未入力チェック
      var tantouWarn = !tantou ? '担当者が未入力です' : '';

      if (!birth) {
        var ci = months.findIndex(function(t) { return t.year === baseYear && t.month === baseMonth; });
        if (ci >= 0) monthData[ci].errorNames.push({ name: name, reason: '生年月日が未入力です', soudan: soudan, tantou: tantou, tantouWarn: tantouWarn, recId: recId });
        return;
      }
      var pm = parsePlanMonths(planStr);
      if (!pm) {
        var ci2 = months.findIndex(function(t) { return t.year === baseYear && t.month === baseMonth; });
        if (ci2 >= 0) monthData[ci2].errorNames.push({ name: name, reason: 'モニタリング月が未設定です', soudan: soudan, tantou: tantou, tantouWarn: tantouWarn, recId: recId });
        return;
      }
      var bm = parseInt(String(birth).split('-')[1], 10), zMo = null, kMo = null;
      if (bm === pm[0]) { zMo = pm[0]; kMo = pm[1]; }
      else if (bm === pm[1]) { zMo = pm[1]; kMo = pm[0]; }
      else {
        var ci3 = months.findIndex(function(t) { return t.year === baseYear && t.month === baseMonth; });
        if (ci3 >= 0) monthData[ci3].errorNames.push({ name: name, reason: '更新月または誕生日を確認', soudan: soudan, tantou: tantou, tantouWarn: tantouWarn, recId: recId });
        return;
      }

      months.forEach(function(t, idx) {
        var type = null;
        if (t.month === zMo) type = 'zenki'; else if (t.month === kMo) type = 'kouki';
        if (!type) return;

        /* 契約日を含む月より前は表示しない（契約日以降のみ表示） */
        if (contractDate) {
          var cp = String(contractDate).split('-');
          var cIdx = parseInt(cp[0], 10) * 12 + (parseInt(cp[1], 10) - 1);
          var tIdx = t.year * 12 + (t.month - 1);
          if (tIdx < cIdx) return;
        }

        var rel = (t.year * 12 + t.month - 1) - (baseYear * 12 + baseMonth - 1);
        var isNext = rel === 1;
        var keikaku = null, kondan = null, evalNew = false, errorMsg = null;
        var signFiles = [];

        /* 過去月・当月・前月・未来月とも同一ロジックで判定する。特別扱いは「来月」のみ。 */
        var isNew = isFirstUpdate(contractDate, t.year, t.month);
        if (isNew) {
          evalNew = true;
          var nrs = findNewUserRecs(name, birth, t.year, t.month, type, maps), rec = nrs.length ? nrs[0] : null;
          /* フォールバック：新規判定の検索窓（開始日フィールドの有無・近さ）で
             見つからない場合でも、日付完全一致のマップに該当レコードが
             あれば必ずそちらを拾う（開始日が正しく入力されているケースの保険）。 */
          if (!rec) {
            var tsNewFallback = firstDateStr(t.year, t.month);
            var mapNewFallback = (type === 'zenki') ? maps.zenkiMultiMap : maps.koukiMultiMap;
            var recsNewFallback = mapNewFallback[name + '|' + birth + '|' + tsNewFallback] || [];
            rec = recsNewFallback[0] || null;
          }
          if (type === 'zenki') {
            keikaku = hasFile(rec, D.K_ZENKI_PLAN); kondan = hasFile(rec, D.K_ZENKI_SIGNED);
            getFileInfos(rec, D.K_ZENKI_SIGNED).forEach(function(f) { signFiles.push(f); });
          } else {
            keikaku = hasFile(rec, D.K_KOUKI_PLAN); kondan = hasFile(rec, D.K_KOUKI_SIGNED);
            getFileInfos(rec, D.K_KOUKI_SIGNED).forEach(function(f) { signFiles.push(f); });
          }
        } else if (type === 'zenki') {
          var ts = firstDateStr(t.year, t.month);
          var crs = maps.zenkiMultiMap[name + '|' + birth + '|' + ts] || [];
          var col = isNext ? 'next' : 'other';
          if (col !== 'next') { if (crs.length === 0) errorMsg = '計画レコードが見つかりません'; else if (crs.length > 1) errorMsg = '計画レコードが重複しています'; }
          if (!errorMsg) {
            var cur = crs[0] || null;
            var ps = shiftMonths(t.year, t.month, -6);
            var prs = maps.koukiMultiMap[name + '|' + birth + '|' + firstDateStr(ps.year, ps.month)] || [];
            /* フォールバック①：契約初年度など、前期と後期が同一レコードに同居する
               変則的な最初のレコードに対応。6か月前ちょうどの後期レコードが
               見つからない場合、まず「今チェックしている前期のレコード自身」に
               後期評価案が入っていないか確認する。 */
            if (prs.length === 0 && cur && hasFile(cur, D.K_KOUKI_EVAL)) {
              prs = [cur];
            }
            /* フォールバック②：それでも見つからない場合、6か月ちょうどでは
               なくても、対象月より前で直近の後期計画開始日を持つレコードを
               採用する（初回期間が短縮されているケースなど）。 */
            if (prs.length === 0) {
              var fallbackPrev = findClosestPriorKouki(name, birth, t.year, t.month, maps);
              if (fallbackPrev) prs = [fallbackPrev];
            }
            keikaku = KEIKAKU_REQUIRE_EVAL ? (hasFile(cur, D.K_ZENKI_PLAN) && hasFileAny(prs, D.K_KOUKI_EVAL)) : hasFile(cur, D.K_ZENKI_PLAN);
            kondan = hasFile(cur, D.K_ZENKI_SIGNED) && hasFileAny(prs, D.K_KOUKI_EVAL_SIGNED);
            getFileInfos(cur, D.K_ZENKI_SIGNED).forEach(function(f) { signFiles.push(f); });
            prs.forEach(function(r) { getFileInfos(r, D.K_KOUKI_EVAL_SIGNED).forEach(function(f) { signFiles.push(f); }); });
          }
        } else {
          var ts2 = firstDateStr(t.year, t.month);
          var crs2 = maps.koukiMultiMap[name + '|' + birth + '|' + ts2] || [];
          var col2 = isNext ? 'next' : 'other';
          if (col2 !== 'next') { if (crs2.length === 0) errorMsg = '計画レコードが見つかりません'; else if (crs2.length > 1) errorMsg = '計画レコードが重複しています'; }
          if (!errorMsg) {
            var cur2 = crs2[0] || null;
            keikaku = KEIKAKU_REQUIRE_EVAL ? (hasFile(cur2, D.K_KOUKI_PLAN) && hasFileAny(crs2, D.K_ZENKI_EVAL)) : hasFile(cur2, D.K_KOUKI_PLAN);
            kondan = hasFile(cur2, D.K_KOUKI_SIGNED) && hasFileAny(crs2, D.K_ZENKI_EVAL_SIGNED);
            getFileInfos(cur2, D.K_KOUKI_SIGNED).forEach(function(f) { signFiles.push(f); });
            crs2.forEach(function(r) { getFileInfos(r, D.K_ZENKI_EVAL_SIGNED).forEach(function(f) { signFiles.push(f); }); });
          }
        }
        /* 来月は懇談を表示しない（未来の懇談は実施できないため） */
        if (!errorMsg && isNext) kondan = null;

        monthData[idx].items.push({
          name: name, kana: kana, soudan: soudan, tantou: tantou, tantouWarn: tantouWarn, recId: recId,
          keikaku: keikaku, kondan: kondan, evalNew: evalNew,
          errorMsg: errorMsg, type: type,
          done: !!(keikaku && kondan), signFiles: signFiles
        });
      });
    });
    monthData.forEach(function(md) { md.items.sort(function(a, b) { return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'); }); });
    return monthData;
  }

  /* ===== データ読込 ===== */
  async function loadDashboardData() {
    var now = new Date(), bY = now.getFullYear(), bM = now.getMonth() + 1;

    var q10 = D.J_STATUS + ' in ("' + escapeQ(D.STATUS_ACTIVE) + '") order by $id asc';
    var jidouRecords = await dashFetchAll(D.APP_JIDOU, q10);

    // 通所先「訪問のみ」を除外
    jidouRecords = jidouRecords.filter(function(r) {
      var ts = r[D.J_TSUUSHO] ? r[D.J_TSUUSHO].value || '' : '';
      return ts !== D.EXCLUDE_TSUUSHO;
    });

    var names = Array.from(new Set(jidouRecords.map(function(r) { return r[D.J_NAME] ? (r[D.J_NAME].value || '') : ''; }).filter(Boolean)));
    var records207 = [];
    for (var i = 0; i < names.length; i += 100) {
      var chunk = names.slice(i, i + 100);
      var inL = chunk.map(function(n) { return '"' + escapeQ(n) + '"'; }).join(',');
      var rcs = await dashFetchAll(D.APP_KEIKAKU, D.K_NAME + ' in (' + inL + ') order by $id asc');
      records207 = records207.concat(rcs);
    }
    var maps = buildMaps(records207);

    return { jidouRecords: jidouRecords, maps: maps, baseYear: bY, baseMonth: bM, totalChildren: jidouRecords.length };
  }

  /* ===== kintoneファイルDL ===== */
  async function downloadKintoneFile(fileKey) {
    var url = kintone.api.url('/k/v1/file', true) + '?fileKey=' + encodeURIComponent(fileKey);
    var resp = await fetch(url, { method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!resp.ok) throw new Error('ファイル取得失敗: ' + resp.status);
    return await resp.arrayBuffer();
  }

  /* 完了児童のサイン済PDF一覧を集める（重複ファイル名は連番で回避） */
  function collectTargetFiles(group) {
    var targets = group.children.filter(function(c) { return c.done && c.signFiles && c.signFiles.length > 0; });
    var usedNames = {};
    var list = [];
    targets.forEach(function(c) {
      c.signFiles.forEach(function(f) {
        var baseName = f.name;
        var finalName = baseName;
        var dupCount = 1;
        while (usedNames[finalName]) {
          var ext = baseName.lastIndexOf('.');
          finalName = (ext >= 0)
            ? baseName.slice(0, ext) + '(' + dupCount + ')' + baseName.slice(ext)
            : baseName + '(' + dupCount + ')';
          dupCount++;
        }
        usedNames[finalName] = true;
        list.push({ fileKey: f.fileKey, name: finalName });
      });
    });
    return list;
  }

  /* フォルダ内に存在するファイル名一覧を取得 */
  async function fsListExistingNames(dirHandle) {
    var names = {};
    try {
      for await (var entry of dirHandle.values()) {
        if (entry.kind === 'file') names[entry.name] = true;
      }
    } catch (e) {
      console.error('[フォルダ保存] 既存ファイル一覧取得失敗:', e);
    }
    return names;
  }

  /* ===== フォルダへ直接保存（File System Access API）=====
     事業所ごとに記憶したフォルダへ、PDFを直接書き込みます。
     forcePick=true の場合は強制的にフォルダ選択ダイアログを出します
     （「フォルダを変更」リンクから呼ばれます）。
     保存先に同名ファイルが既にある場合は、事前に確認ポップアップを出し、
     「上書きする」「スキップする」「キャンセル」を選んでもらいます。 */
  async function saveToFolder(group, progressCb, forcePick) {
    var files = collectTargetFiles(group);
    if (files.length === 0) {
      alert('保存対象のPDFがありません。');
      return;
    }

    var dirHandle;
    try {
      dirHandle = await fsGetOrPickFolder(group.soudan, forcePick);
    } catch (e) {
      if (e && e.name === 'AbortError') { progressCb('キャンセル'); return; }
      throw e;
    }

    /* 既存ファイルとの重複を事前チェック */
    progressCb('重複を確認中…');
    var existingNames = await fsListExistingNames(dirHandle);
    var duplicates = files.filter(function(f) { return existingNames[f.name]; });

    var skipNames = {};
    if (duplicates.length > 0) {
      var list = duplicates.map(function(f) { return '・' + f.name; }).join('\n');
      var msg = '保存先フォルダに同名のファイルが既にあります（' + duplicates.length + '件）。\n\n' +
        list + '\n\n' +
        '「OK」を押すとこれらのファイルを上書きします。\n' +
        '「キャンセル」を押すと、これらのファイルだけ保存をスキップします（他のファイルは保存されます）。';
      var overwrite = confirm(msg);
      if (!overwrite) {
        duplicates.forEach(function(f) { skipNames[f.name] = true; });
      }
    }

    var targetFiles = files.filter(function(f) { return !skipNames[f.name]; });
    if (targetFiles.length === 0) {
      progressCb('キャンセル');
      return;
    }

    progressCb('0/' + targetFiles.length + ' 件 保存中…');
    var done = 0;
    var skipped = duplicates.filter(function(f) { return skipNames[f.name]; }).length;
    for (var i = 0; i < targetFiles.length; i++) {
      var f = targetFiles[i];
      try {
        var buf = await downloadKintoneFile(f.fileKey);
        var fileHandle = await dirHandle.getFileHandle(f.name, { create: true });
        var writable = await fileHandle.createWritable();
        await writable.write(buf);
        await writable.close();
      } catch (e) {
        console.error('[フォルダ保存] 失敗:', f.name, e);
      }
      done++;
      progressCb(done + '/' + targetFiles.length + ' 件 保存中…');
    }
    progressCb(skipped > 0 ? ('完了（' + skipped + '件スキップ）') : '完了');
  }

  /* ===== 全事業所への一括保存 =====
     その月の保存対象がある事業所すべてに対して、順番に saveToFolder を実行します。
     事業所ごとにフォルダが記憶済みならダイアログは出ません。未記憶の事業所のみ
     選択ダイアログが出ます。1事業所ずつ進捗を progressCb で通知します。
     戻り値: { soudan, status:'done'|'skip'|'error'|'cancel', detail } の配列 */
  async function saveAllGroupsToFolder(groups, progressCb) {
    var allCandidates = groups.filter(function(g) {
      return g.doneCount > 0 && collectTargetFiles(g).length > 0;
    });
    var targets = allCandidates.filter(function(g) { return !isSoudanExcluded(g.soudan); });
    var excludedCount = allCandidates.length - targets.length;
    var results = [];

    for (var i = 0; i < targets.length; i++) {
      var g = targets[i];
      var label = g.soudan || '（事業所未設定）';
      progressCb({ index: i, total: targets.length, soudan: label, status: 'progress', message: '準備中…' });

      try {
        await saveToFolder(g, function(msg) {
          progressCb({ index: i, total: targets.length, soudan: label, status: 'progress', message: msg });
        }, false);
        results.push({ soudan: label, status: 'done' });
      } catch (e) {
        if (e && e.name === 'AbortError') {
          results.push({ soudan: label, status: 'cancel' });
        } else {
          console.error('[一括保存] 失敗:', label, e);
          results.push({ soudan: label, status: 'error', detail: e.message });
        }
      }
    }

    progressCb({ index: targets.length, total: targets.length, status: 'all-done', results: results, excludedCount: excludedCount });
    return results;
  }

  /* ===== ZIP生成 (事業所単位・File System Access API非対応ブラウザ用フォールバック) ===== */
  async function downloadZip(group, label, year, month, progressCb) {
    await loadJSZip();
    var zip = new JSZip();
    var files = collectTargetFiles(group);
    if (files.length === 0) { alert('ダウンロード対象のPDFがありません。'); return; }
    var done = 0; progressCb('0/' + files.length);
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try { var buf = await downloadKintoneFile(f.fileKey); zip.file(f.name, buf); } catch (e) { console.error('[ZIP]', f.name, e); }
      done++; progressCb(done + '/' + files.length);
    }
    progressCb('ZIP作成中…');
    var blob = await zip.generateAsync({ type: 'blob' });
    var zipName = label + '_' + year + '年' + month + '月.zip';
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = zipName;
    document.body.appendChild(a); a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    progressCb('完了');
  }

  /* ===== 描画 ===== */
  function renderDashboard(container, data) {
    var bY = data.baseYear, bM = data.baseMonth;
    if (selectedFiscalYear === null) selectedFiscalYear = getCurrentFiscalYear();
    var months = getFiscalMonths(selectedFiscalYear);

    // 当月タブをデフォルト選択
    if (selectedMonthIdx === null) {
      selectedMonthIdx = months.findIndex(function(t) { return t.year === bY && t.month === bM; });
      if (selectedMonthIdx < 0) selectedMonthIdx = 0;
    }

    var monthData = buildAllMonthData(data.jidouRecords, months, data.maps, bY, bM);

    // ヘッダー
    var html =
      '<div class="d228-head">' +
        '<div class="d228-title">📋 支援計画 進捗ダッシュボード</div>' +
        '<div class="d228-summary"><span class="d228-sum-item">利用中 <b>' + data.totalChildren + '</b>名</span></div>' +
        '<a class="d228-refresh" href="javascript:void(0)" id="d228-refresh-btn">🔄 再読込</a>' +
      '</div>';

    // 年度ナビ
    html += '<div class="d228-year-nav">' +
      '<button id="d228-prev-fy">◀</button>' +
      '<span class="d228-fy-label">' + selectedFiscalYear + '年度</span>' +
      '<button id="d228-next-fy">▶</button>' +
    '</div>';

    // 月タブ
    html += '<div class="d228-tabs">';
    months.forEach(function(t, idx) {
      var cls = 'd228-mtab';
      if (idx === selectedMonthIdx) cls += ' d228-mtab-sel';
      var rel = (t.year * 12 + t.month - 1) - (bY * 12 + bM - 1);
      if (rel === 0) cls += ' d228-mtab-curr';
      var badge = '';
      if (rel === 0) badge = '<span class="d228-tbadge">今月</span>';
      else if (rel === -1) badge = '<span class="d228-tbadge">前月</span>';
      else if (rel === 1) badge = '<span class="d228-tbadge">来月</span>';
      html += '<div class="' + cls + '" data-midx="' + idx + '">' + t.month + '月' + badge + '</div>';
    });
    html += '</div>';

    // 月コンテンツ
    html += '<div id="d228-content">' + renderMonthContent(monthData[selectedMonthIdx], months[selectedMonthIdx], bY, bM) + '</div>';

    container.innerHTML = '<div class="d228-wrap">' + html + '</div>';
    bindEvents(container, data, months, monthData);
  }

  function renderMonthContent(md, month, bY, bM) {
    var rel = (month.year * 12 + month.month - 1) - (bY * 12 + bM - 1);
    var showKondan = rel !== 1;

    // 事業所グループ化
    var groups = {};
    md.items.forEach(function(item) {
      var key = item.soudan || '';
      if (!groups[key]) groups[key] = { soudan: key, children: [] };
      groups[key].children.push(item);
    });
    md.errorNames.forEach(function(e) {
      var key = e.soudan || '';
      if (!groups[key]) groups[key] = { soudan: key, children: [] };
      groups[key].children.push({
        name: e.name, kana: '', soudan: e.soudan, tantou: e.tantou, tantouWarn: e.tantouWarn, recId: e.recId,
        keikaku: null, kondan: null, evalNew: false, errorMsg: e.reason, type: null, done: false, signFiles: []
      });
    });

    var gList = Object.keys(groups).map(function(k) { return groups[k]; });
    gList.forEach(function(g) {
      var due = g.children.filter(function(c) { return !c.errorMsg; });
      var done = due.filter(function(c) { return c.done; });
      g.dueCount = due.length; g.doneCount = done.length;
      g.allDone = g.dueCount > 0 && g.doneCount === g.dueCount;
    });
    gList.sort(function(a, b) {
      if (!a.soudan && b.soudan) return 1; if (a.soudan && !b.soudan) return -1;
      return a.soudan.localeCompare(b.soudan, 'ja');
    });

    var totalDue = 0, totalDone = 0;
    gList.forEach(function(g) { totalDue += g.dueCount; totalDone += g.doneCount; });

    var totalDoneGroups = gList.filter(function(g) { return g.doneCount > 0 && !isSoudanExcluded(g.soudan); }).length;
    var saveAllBtn = (FS_SUPPORTED && totalDoneGroups > 0)
      ? '<button class="d228-saveall-btn" id="d228-saveall-btn">📁 全事業所へ一括保存（' + totalDoneGroups + '事業所）</button>'
      : '';

    var html = '<div class="d228-mhead">' +
      '<span class="d228-mhead-label">' + month.year + '年' + month.month + '月</span>' +
      '<span class="d228-mhead-stat">対象 <b>' + totalDue + '</b>名 ／ 完了 <b>' + totalDone + '</b>名</span>' +
      saveAllBtn +
    '</div>';

    gList.forEach(function(g, gi) {
      var sLabel = g.soudan ? escapeHtml(g.soudan) : '（事業所 未設定）';
      var excluded = FS_SUPPORTED && isSoudanExcluded(g.soudan);
      var badge;
      if (excluded) badge = '<span class="d228-badge d228-badge-excluded">保存対象外</span>';
      else if (g.dueCount === 0) badge = '<span class="d228-badge d228-badge-none">今月対象なし</span>';
      else if (g.allDone) badge = '<span class="d228-badge d228-badge-done">全員完了 ' + g.doneCount + '/' + g.dueCount + '</span>';
      else badge = '<span class="d228-badge d228-badge-progress">' + g.doneCount + '/' + g.dueCount + '</span>';

      var dlBtn = '';
      if (g.doneCount > 0) {
        if (FS_SUPPORTED && excluded) {
          dlBtn = '<a class="d228-toggle-exclude" href="javascript:void(0)" data-gidx="' + gi + '" data-action="include">対象に戻す</a>';
        } else if (FS_SUPPORTED) {
          dlBtn = '<button class="d228-dl-btn" data-gidx="' + gi + '">📁 フォルダへ保存（' + g.doneCount + '名分）</button>' +
            '<a class="d228-change-folder" href="javascript:void(0)" data-gidx="' + gi + '">フォルダ変更</a>' +
            '<a class="d228-toggle-exclude" href="javascript:void(0)" data-gidx="' + gi + '" data-action="exclude">対象外にする</a>';
        } else {
          dlBtn = '<button class="d228-dl-btn d228-dl-zip" data-gidx="' + gi + '">📥 ZIPで保存（' + g.doneCount + '名分）</button>';
        }
      }

      var rowsHtml = g.children.map(function(c) {
        return buildRowHtml(c, showKondan);
      }).join('');

      html += '<section class="d228-group' + (g.allDone ? ' d228-group-done' : '') + '">' +
        '<div class="d228-group-head">' +
          '<div class="d228-group-name">' + sLabel + '</div>' +
          '<div class="d228-group-meta">' + badge + dlBtn + '</div>' +
        '</div>' +
        '<div class="d228-group-body">' + (rowsHtml || '<div class="d228-empty">対象なし</div>') + '</div>' +
      '</section>';
    });

    if (!gList.length) html += '<div class="d228-empty" style="padding:20px;">この月に更新対象の児童はいません。</div>';

    // gListをdata属性で保存（イベント用）
    html += '<script type="application/json" id="d228-glist-data">' + JSON.stringify(gList.map(function(g) { return { soudan: g.soudan, children: g.children }; })) + '</script>';

    return html;
  }

  function buildRowHtml(c, showKondan) {
    var nameLink = c.recId
      ? '<a class="d228-cname" href="' + KINTONE_BASE + '/k/' + D.APP_JIDOU + '/show#record=' + c.recId + '" target="_blank">' + escapeHtml(c.name) + '</a>'
      : '<span class="d228-cname">' + escapeHtml(c.name) + '</span>';
    var tantouHtml = c.tantou
      ? '<span class="d228-ctantou">' + escapeHtml(c.tantou) + '</span>'
      : '<span class="d228-ctantou d228-tantou-warn">（未設定）</span>';
    var warnHtml = c.tantouWarn ? '<span class="d228-cwarn">' + escapeHtml(c.tantouWarn) + '</span>' : '';

    if (c.errorMsg) {
      return '<div class="d228-row d228-row-err">' + nameLink + tantouHtml +
        '<span class="d228-cstatus"></span>' +
        '<span class="d228-cerr">⚠️ ' + escapeHtml(c.errorMsg) + '</span>' +
        warnHtml + '</div>';
    }

    var kMk = c.keikaku ? iconDone() : iconPending();
    var statusHtml = '計画' + kMk;
    if (showKondan && c.kondan !== null) {
      statusHtml += '　懇談' + (c.kondan ? iconDone() : iconPending());
    }
    if (c.evalNew) statusHtml += iconNew();
    var allDone = c.keikaku && (showKondan ? c.kondan : true);

    return '<div class="d228-row' + (allDone ? ' d228-row-done' : ' d228-row-todo') + '">' +
      nameLink + tantouHtml +
      '<span class="d228-cstatus">' + statusHtml + '</span>' +
      warnHtml + '</div>';
  }

  function bindEvents(container, data, months, monthData) {
    // 月タブ
    container.querySelectorAll('.d228-mtab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        selectedMonthIdx = parseInt(tab.dataset.midx, 10);
        var md = monthData[selectedMonthIdx];
        var cel = document.getElementById('d228-content');
        if (cel) { cel.innerHTML = renderMonthContent(md, months[selectedMonthIdx], data.baseYear, data.baseMonth); bindContentEvents(container, data, months, monthData); }
        container.querySelectorAll('.d228-mtab').forEach(function(t) { t.classList.remove('d228-mtab-sel'); });
        tab.classList.add('d228-mtab-sel');
      });
    });
    // 年度ナビ
    var prevFy = document.getElementById('d228-prev-fy');
    var nextFy = document.getElementById('d228-next-fy');
    if (prevFy) prevFy.addEventListener('click', function() { selectedFiscalYear--; selectedMonthIdx = 0; renderDashboard(container, data); });
    if (nextFy) nextFy.addEventListener('click', function() { selectedFiscalYear++; selectedMonthIdx = 0; renderDashboard(container, data); });
    // 再読込
    var rb = document.getElementById('d228-refresh-btn');
    if (rb) rb.addEventListener('click', function() { selectedMonthIdx = null; selectedFiscalYear = null; cachedData = null; runDashboard(container); });
    bindContentEvents(container, data, months, monthData);
  }

  function bindContentEvents(container, data, months, monthData) {
    /* 全事業所への一括保存 */
    var saveAllBtn = document.getElementById('d228-saveall-btn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', function() {
        var md = monthData[selectedMonthIdx];
        var gListEl = document.getElementById('d228-glist-data');
        if (!gListEl) return;
        var gList = JSON.parse(gListEl.textContent);
        var origLabel = saveAllBtn.textContent;
        saveAllBtn.disabled = true;
        saveAllGroupsToFolder(gList, function(p) {
          if (p.status === 'all-done') {
            var okCount = p.results.filter(function(r) { return r.status === 'done'; }).length;
            var errCount = p.results.filter(function(r) { return r.status === 'error'; }).length;
            var cancelCount = p.results.filter(function(r) { return r.status === 'cancel'; }).length;
            var summary = '✅ 完了 ' + okCount + '/' + p.total + '事業所';
            if (errCount > 0) summary += '（エラー' + errCount + '件）';
            if (cancelCount > 0) summary += '（中断' + cancelCount + '件）';
            if (p.excludedCount > 0) summary += '（対象外' + p.excludedCount + '件）';
            saveAllBtn.textContent = summary;
            if (errCount > 0) {
              var errLines = p.results.filter(function(r) { return r.status === 'error'; })
                .map(function(r) { return '・' + r.soudan + '：' + r.detail; }).join('\n');
              alert('一部の事業所で保存に失敗しました。\n\n' + errLines);
            }
            setTimeout(function() { saveAllBtn.textContent = origLabel; saveAllBtn.disabled = false; }, 4000);
          } else {
            saveAllBtn.textContent = '📁 [' + (p.index + 1) + '/' + p.total + '] ' + p.soudan + '：' + p.message;
          }
        }).catch(function(e) {
          saveAllBtn.textContent = '📁 再試行'; saveAllBtn.disabled = false;
          alert('一括保存エラー: ' + e.message);
        });
      });
    }

    /* フォルダへ直接保存（File System Access API対応ブラウザ） */
    container.querySelectorAll('.d228-dl-btn:not(.d228-dl-zip)').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var gi = parseInt(btn.dataset.gidx, 10);
        var gListEl = document.getElementById('d228-glist-data');
        if (!gListEl) return;
        var gList = JSON.parse(gListEl.textContent);
        var g = gList[gi]; if (!g) return;
        btn.disabled = true;
        var doneCount = g.children.filter(function(c) { return !c.errorMsg && c.done; }).length;
        var origLabel = '📁 フォルダへ保存（' + doneCount + '名分）';
        saveToFolder(g, function(msg) {
          var isDone = (msg === '完了' || msg.indexOf('完了') === 0);
          btn.textContent = isDone ? ('✅ ' + msg) : (msg === 'キャンセル' ? origLabel : msg);
          if (isDone) {
            btn.classList.add('d228-dl-done');
            setTimeout(function() { btn.textContent = origLabel; btn.disabled = false; btn.classList.remove('d228-dl-done'); }, 3500);
          } else if (msg === 'キャンセル') { btn.disabled = false; }
        }, false).catch(function(e) {
          btn.textContent = '📁 再試行'; btn.disabled = false;
          alert('フォルダ保存エラー: ' + e.message);
        });
      });
    });

    /* ZIPダウンロード（File System Access API非対応ブラウザ用フォールバック） */
    container.querySelectorAll('.d228-dl-btn.d228-dl-zip').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var gi = parseInt(btn.dataset.gidx, 10);
        var gListEl = document.getElementById('d228-glist-data');
        if (!gListEl) return;
        var gList = JSON.parse(gListEl.textContent);
        var g = gList[gi]; if (!g) return;
        var m = months[selectedMonthIdx];
        btn.disabled = true;
        var doneCount = g.children.filter(function(c) { return !c.errorMsg && c.done; }).length;
        var origLabel = '📥 ZIPで保存（' + doneCount + '名分）';
        downloadZip(g, g.soudan || '事業所未設定', m.year, m.month, function(msg) {
          btn.textContent = msg === '完了' ? '✅ 保存完了' : msg;
          if (msg === '完了') {
            btn.classList.add('d228-dl-done');
            setTimeout(function() { btn.textContent = origLabel; btn.disabled = false; btn.classList.remove('d228-dl-done'); }, 3000);
          }
        }).catch(function(e) { btn.textContent = '📥 再試行'; btn.disabled = false; alert('ZIP作成エラー: ' + e.message); });
      });
    });

    /* フォルダ変更リンク：次回保存時に強制的に選択ダイアログを出すよう記憶を更新 */
    container.querySelectorAll('.d228-change-folder').forEach(function(link) {
      link.addEventListener('click', function() {
        var gi = parseInt(link.dataset.gidx, 10);
        var gListEl = document.getElementById('d228-glist-data');
        if (!gListEl) return;
        var gList = JSON.parse(gListEl.textContent);
        var g = gList[gi]; if (!g) return;
        window.showDirectoryPicker({ mode: 'readwrite' }).then(function(handle) {
          return fsSetHandle(fsKeyForGroup(g.soudan), handle);
        }).then(function() {
          link.textContent = '✅ 変更しました';
          setTimeout(function() { link.textContent = 'フォルダ変更'; }, 2000);
        }).catch(function(e) {
          if (!(e && e.name === 'AbortError')) alert('フォルダ変更エラー: ' + e.message);
        });
      });
    });

    /* 対象外にする／対象に戻す：事業所ごとに一括保存・個別保存から除外する設定を切り替える */
    container.querySelectorAll('.d228-toggle-exclude').forEach(function(link) {
      link.addEventListener('click', function() {
        var gi = parseInt(link.dataset.gidx, 10);
        var gListEl = document.getElementById('d228-glist-data');
        if (!gListEl) return;
        var gList = JSON.parse(gListEl.textContent);
        var g = gList[gi]; if (!g) return;
        var action = link.dataset.action;
        setSoudanExcluded(g.soudan, action === 'exclude');
        var md = monthData[selectedMonthIdx];
        var cel = document.getElementById('d228-content');
        if (cel) {
          cel.innerHTML = renderMonthContent(md, months[selectedMonthIdx], data.baseYear, data.baseMonth);
          bindContentEvents(container, data, months, monthData);
        }
      });
    });
  }

  async function runDashboard(container) {
    container.innerHTML = '<div class="d228-loading">読み込み中…</div>';
    try {
      if (!cachedData) cachedData = await loadDashboardData();
      renderDashboard(container, cachedData);
    } catch (e) {
      container.innerHTML = '<div class="d228-error">データ取得中にエラーが発生しました。<br>' + escapeHtml(String(e)) + '</div>';
      console.error('[228ダッシュボード]', e);
    }
  }

  /* ===== CSS ===== */
  function injectStyle() {
    if (document.getElementById('iroha-228-style')) return;
    var css =
      '.d228-wrap{max-width:1100px;margin:0 auto;padding:8px 4px 40px;}' +
      '.d228-loading,.d228-error{padding:20px;font-size:14px;color:#888;}' +
      '.d228-error{color:#c0392b;}' +
      '.d228-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;background:#5a8f5a;color:#fff;border-radius:10px;margin-bottom:10px;}' +
      '.d228-title{font-size:16px;font-weight:700;}' +
      '.d228-summary{margin-left:auto;display:flex;gap:8px;}' +
      '.d228-sum-item{font-size:13px;background:rgba(255,255,255,.18);padding:4px 10px;border-radius:6px;}' +
      '.d228-sum-item b{font-size:15px;}' +
      '.d228-refresh{color:#fff;text-decoration:none;font-size:12px;background:rgba(0,0,0,.15);padding:5px 10px;border-radius:6px;}' +
      /* 年度ナビ */
      '.d228-year-nav{display:flex;align-items:center;justify-content:center;gap:16px;margin:8px 0;}' +
      '.d228-year-nav button{font-size:20px;padding:6px 16px;border:1px solid #b0b0b0;border-radius:6px;background:#fff;cursor:pointer;min-height:38px;}' +
      '.d228-year-nav button:active{background:#e8e8e8;}' +
      '.d228-fy-label{font-size:20px;font-weight:700;min-width:120px;text-align:center;}' +
      /* 月タブ */
      '.d228-tabs{display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-bottom:12px;border-bottom:2px solid #dde8dd;padding-bottom:0;}' +
      '.d228-mtab{padding:8px 14px;font-size:14px;font-weight:600;cursor:pointer;border-radius:8px 8px 0 0;color:#666;background:#f5f8f5;border:1px solid transparent;border-bottom:none;user-select:none;}' +
      '.d228-mtab:hover{background:#e8f0e8;color:#333;}' +
      '.d228-mtab-sel{background:#fff;color:#3a5a3a;border-color:#dde8dd;position:relative;margin-bottom:-2px;border-bottom:2px solid #fff;}' +
      '.d228-mtab-curr{font-weight:800;}' +
      '.d228-tbadge{font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;margin-left:4px;background:#5a8f5a;color:#fff;vertical-align:middle;}' +
      '.d228-mtab-sel .d228-tbadge{background:#3a6a3a;}' +
      /* 月ヘッダー */
      '.d228-mhead{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 14px;margin-bottom:10px;}' +
      '.d228-mhead-label{font-size:18px;font-weight:700;color:#33523a;}' +
      '.d228-mhead-stat{font-size:13px;color:#666;margin-left:auto;}' +
      '.d228-mhead-stat b{font-size:15px;color:#333;}' +
      '.d228-saveall-btn{font-size:13px;font-weight:700;background:#1a5d99;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;white-space:nowrap;margin-left:8px;}' +
      '.d228-saveall-btn:hover{background:#144a7d;}' +
      '.d228-saveall-btn:disabled{opacity:.75;cursor:default;}' +
      /* グループ */
      '.d228-group{border:1px solid #dde8dd;border-radius:10px;margin-bottom:12px;overflow:hidden;background:#fff;}' +
      '.d228-group-done{border-color:#7cc77c;}' +
      '.d228-group-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;background:#eef5ee;border-bottom:1px solid #e0ece0;}' +
      '.d228-group-done .d228-group-head{background:#e3f5e3;}' +
      '.d228-group-name{font-size:15px;font-weight:700;color:#33523a;}' +
      '.d228-group-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.d228-badge{font-size:12px;font-weight:700;padding:4px 10px;border-radius:14px;}' +
      '.d228-badge-done{background:#2e9e3f;color:#fff;}' +
      '.d228-badge-progress{background:#fff4d6;color:#b9770a;border:1px solid #f0d28a;}' +
      '.d228-badge-none{background:#eee;color:#999;}' +
      '.d228-badge-excluded{background:#f3f0e8;color:#9a8a5a;border:1px solid #e0d6b8;}' +
      '.d228-dl-btn,.d228-dl-all-btn{font-size:12px;font-weight:700;background:#2e7d32;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;white-space:nowrap;}' +
      '.d228-dl-btn:hover,.d228-dl-all-btn:hover{background:#256528;}' +
      '.d228-dl-btn:disabled,.d228-dl-all-btn:disabled{opacity:.7;cursor:default;}' +
      '.d228-dl-done{background:#888!important;}' +
      '.d228-change-folder{font-size:11px;color:#888;text-decoration:underline;white-space:nowrap;margin-left:2px;}' +
      '.d228-change-folder:hover{color:#555;}' +
      '.d228-toggle-exclude{font-size:11px;color:#999;text-decoration:underline;white-space:nowrap;margin-left:2px;}' +
      '.d228-toggle-exclude:hover{color:#666;}' +
      '.d228-group-body{padding:4px 10px 8px;}' +
      /* 行 (インラインレイアウト) */
      '.d228-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid #f0f4f0;font-size:13px;flex-wrap:wrap;}' +
      '.d228-row:last-child{border-bottom:none;}' +
      '.d228-cname{font-weight:600;color:#2b6cb0;text-decoration:none;min-width:7em;flex:0 0 auto;}' +
      '.d228-cname:hover{text-decoration:underline;}' +
      '.d228-ctantou{color:#666;font-size:12px;min-width:5em;flex:0 0 auto;}' +
      '.d228-tantou-warn{color:#d9534f;font-weight:600;}' +
      '.d228-cstatus{color:#555;white-space:nowrap;}' +
      '.d228-cerr{color:#c0392b;font-size:12px;flex:1 1 auto;}' +
      '.d228-cwarn{color:#e67e22;font-size:11px;}' +
      '.d228-row-todo{background:#fff7f7;}' +
      '.d228-row-done .d228-cname{color:#2e7d32;}' +
      '.d228-row-err{background:#fff0f0;}' +
      '.d228-empty{color:#bbb;font-size:13px;padding:8px;}' +
      /* アイコン */
      '.d228-icon-done{color:#2e9e3f;font-size:14px;}' +
      '.d228-icon-pending{display:inline-block;width:13px;height:13px;border:2px solid #bbb;border-radius:3px;box-sizing:border-box;vertical-align:middle;}' +
      '.d228-new-label{display:inline-block;background:#ff6b6b;color:#fff;font-size:10px;font-weight:800;padding:1px 5px;border-radius:3px;margin-left:3px;vertical-align:middle;letter-spacing:.5px;}' +
      /* レスポンシブ */
      '@media(max-width:600px){' +
        '.d228-summary{margin-left:0;width:100%;}' +
        '.d228-group-meta{margin-left:0;width:100%;}' +
        '.d228-cname{min-width:auto;}' +
        '.d228-ctantou{min-width:auto;}' +
        '.d228-cstatus{width:100%;}' +
        '.d228-mtab{padding:6px 10px;font-size:13px;}' +
      '}';
    var st = document.createElement('style'); st.id = 'iroha-228-style'; st.textContent = css; document.head.appendChild(st);
  }

  /* ===== イベント登録 ===== */
  kintone.events.on('app.record.index.show', function(event) {
    if (event.viewType !== 'custom') return event;
    var container = document.getElementById(D.CONTAINER_ID);
    if (!container) return event;
    if (dashRendered && container.dataset.d228Done) return event;
    dashRendered = true; container.dataset.d228Done = '1';
    injectStyle(); runDashboard(container);
    return event;
  });
})();
