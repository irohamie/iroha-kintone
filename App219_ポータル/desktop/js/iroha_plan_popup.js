/* =========================================================================
   【追加機能】支援計画 更新状況ポップアップ（アプリ219 ポータル用 追加JS）
   =========================================================================
   ・v2: アイコン変更（☐=未提出 / ✅=完了 / NEW=新規利用者）
   -------------------------------------------------------------------------
   【今回のバグ修正】
   ・契約初年度など、初回の期間が短縮された変則的なケースで、
     次の前期の完了判定（前期案＋直前の後期評価案の両方が必要）が
     「6か月前ちょうど」の日付でしか後期レコードを探していなかった
     ため、直前の後期評価案が見つからず✅が付かない不具合を修正。
     → findNewUserRecordByType にフォールバック（前期/後期どちらかの
       開始日しか入っていない同一レコードも対象にする）を追加。
     → 新規利用者の簡易判定でも、開始日フィールドの検索窓に
       引っかからない場合は日付完全一致マップにもフォールバックする。
     → 前期の完了判定に、
       ①同一レコード自身に後期評価案が入っていないか
       ②それでも無ければ、対象月より前で直近の後期計画開始日を持つ
         レコード
       の2段階フォールバックを追加した。
   ========================================================================= */
(function () {
  'use strict';

  const F = {
    APP_JIDOU:   10,
    APP_KEIKAKU: 207,
    J_NAME:     '児童氏名',
    J_KANA:     '児童フリガナ',
    J_PLAN:     '支援計画',
    J_TANTOU:   '担当',
    J_STATUS:   '利用状況',
    J_BIRTH:    '誕生日',
    J_CONTRACT: '契約日',
    STATUS_ACTIVE: '利用中',
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
  const SNOOZE_KEY = 'iroha_plan_popup_snooze_until';
  let planPopupDone = false;

  function shiftMonths(year, month, delta) { const idx = year * 12 + (month - 1) + delta; return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }; }
  function firstDateStr(year, month) { return year + '-' + String(month).padStart(2, '0') + '-01'; }
  function parsePlanMonths(planStr) {
    if (!planStr) return null;
    const matches = String(planStr).match(/(\d{1,2})\s*月/g);
    if (!matches || matches.length < 2) return null;
    const nums = matches.map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 12);
    return nums.length >= 2 ? [nums[0], nums[1]] : null;
  }
  function hasFile(record, fieldCode) { if (!record) return false; const f = record[fieldCode]; if (!f || !f.value) return false; return Array.isArray(f.value) && f.value.length > 0; }
  function escapeQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function isSnoozed() { const v = localStorage.getItem(SNOOZE_KEY); if (!v) return false; return Date.now() < parseInt(v, 10); }
  function snoozeToday() { const t = new Date(); t.setHours(24, 0, 0, 0); localStorage.setItem(SNOOZE_KEY, String(t.getTime())); }
  function snoozeWeek() { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 7); localStorage.setItem(SNOOZE_KEY, String(t.getTime())); }

  function isFirstUpdate(contractDate, targetYear, targetMonth) {
    if (!contractDate) return false;
    const p = String(contractDate).split('-');
    const cy = parseInt(p[0], 10), cm = parseInt(p[1], 10);
    if (isNaN(cy) || isNaN(cm)) return false;
    const cIdx = cy * 12 + (cm - 1), tIdx = targetYear * 12 + (targetMonth - 1);
    return cIdx >= (tIdx - (UPDATE_INTERVAL - 1)) && cIdx <= tIdx;
  }

  function buildMessage(col, keikaku, kondan, today) {
    const day = today.getDate();
    const msgs = [];
    if (col === 'prev') {
      if (!keikaku) msgs.push({ level: 'danger', text: '支援計画が保存されていません。確認してください。' });
      if (kondan === false) msgs.push({ level: 'warn', text: '保護者側の都合で懇談日程が決まらない・キャンセルがあった場合は、記録に残してください。' });
    }
    if (col === 'curr') {
      if (!keikaku) msgs.push({ level: 'danger', text: '支援計画が保存されていません。確認してください。' });
      if (kondan === false && day >= 21) msgs.push({ level: 'warn', text: '懇談後のPDF保存し忘れがないか確認してください。' });
    }
    if (col === 'next') {
      if (!keikaku && day >= 21) msgs.push({ level: 'warn', text: '提出期限を過ぎています。計画のPDF保存を確認してください。' });
    }
    return msgs;
  }

  function sortScore(it, showKondan) { if (!it.keikaku) return 0; if (showKondan && !it.kondan) return 1; return 2; }

  async function fetchAll(app, baseQuery) {
    let all = [], offset = 0;
    while (true) {
      const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: app, query: baseQuery + ' limit 500 offset ' + offset });
      all = all.concat(resp.records);
      if (resp.records.length < 500) break;
      offset += 500; if (offset > 9500) break;
    }
    return all;
  }

  kintone.events.on('app.record.index.show', async (event) => {
    if (!document.getElementById('iroha-portal')) return event;
    if (planPopupDone) return event;
    planPopupDone = true;
    if (isSnoozed()) return event;
    try { await runPlanPopup(); } catch (e) { console.error('[支援計画ポップアップ]', e); }
    return event;
  });

  async function runPlanPopup() {
    const q10 = F.J_STATUS + ' in ("' + escapeQ(F.STATUS_ACTIVE) + '") and ' + F.J_TANTOU + ' in (LOGINUSER()) order by $id asc';
    const jidouRecords = await fetchAll(F.APP_JIDOU, q10);
    if (!jidouRecords.length) return;
    const now = new Date(), baseYear = now.getFullYear(), baseMonth = now.getMonth() + 1;
    const targets = { prev: shiftMonths(baseYear, baseMonth, -1), curr: { year: baseYear, month: baseMonth }, next: shiftMonths(baseYear, baseMonth, 1) };
    const classified = classifyChildren(jidouRecords, targets);
    if (!classified.children.length && !classified.errorChildren.length) return;
    const records207 = await fetchPlanRecords(classified.children);
    const maps = buildMaps(records207);
    const cols = evaluateChildren(classified.children, maps, now);
    injectStyle();
    renderPopup(cols, classified.errorChildren, targets);
  }

  function classifyChildren(jidouRecords, targets) {
    const children = [], errorChildren = [];
    jidouRecords.forEach(r => {
      const name = r[F.J_NAME] ? (r[F.J_NAME].value || '') : '';
      const kana = r[F.J_KANA] ? (r[F.J_KANA].value || '') : '';
      const planStr = r[F.J_PLAN] ? (r[F.J_PLAN].value || '') : '';
      const birth = r[F.J_BIRTH] ? (r[F.J_BIRTH].value || '') : '';
      const contractDate = r[F.J_CONTRACT] ? (r[F.J_CONTRACT].value || '') : '';
      if (!name) return;
      const months = parsePlanMonths(planStr);
      if (!months) return;
      if (!birth) { errorChildren.push({ name: name, kana: kana, reason: '生年月日が未入力です' }); return; }
      const birthMonth = parseInt(String(birth).split('-')[1], 10);
      let zenkiMonth = null, koukiMonth = null;
      if (birthMonth === months[0]) { zenkiMonth = months[0]; koukiMonth = months[1]; }
      else if (birthMonth === months[1]) { zenkiMonth = months[1]; koukiMonth = months[0]; }
      else { errorChildren.push({ name: name, kana: kana, reason: '更新月または生年月日を確認してください' }); return; }
      let assigned = null;
      ['prev', 'curr', 'next'].forEach(col => {
        if (assigned) return;
        const t = targets[col];
        if (t.month === zenkiMonth) assigned = { col, type: 'zenki', t };
        else if (t.month === koukiMonth) assigned = { col, type: 'kouki', t };
      });
      if (!assigned) return;
      children.push({ name, kana, birth, contractDate, assigned });
    });
    return { children, errorChildren };
  }

  async function fetchPlanRecords(children) {
    const names = Array.from(new Set(children.map(c => c.name)));
    if (!names.length) return [];
    let records207 = [];
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const inList = chunk.map(n => '"' + escapeQ(n) + '"').join(',');
      records207 = records207.concat(await fetchAll(F.APP_KEIKAKU, F.K_NAME + ' in (' + inList + ') order by $id asc'));
    }
    return records207;
  }

  function buildMaps(records207) {
    const zenkiMap={},koukiMap={},zenkiMultiMap={},koukiMultiMap={},allByPerson={};
    records207.forEach(r => {
      const nm=r[F.K_NAME]?r[F.K_NAME].value||'':'', bd=r[F.K_BIRTH]?r[F.K_BIRTH].value||'':'';
      const zs=r[F.K_ZENKI_START]?r[F.K_ZENKI_START].value||'':'', ks=r[F.K_KOUKI_START]?r[F.K_KOUKI_START].value||'':'';
      if(zs){const k=nm+'|'+bd+'|'+zs;zenkiMap[k]=r;if(!zenkiMultiMap[k])zenkiMultiMap[k]=[];zenkiMultiMap[k].push(r);}
      if(ks){const k=nm+'|'+bd+'|'+ks;koukiMap[k]=r;if(!koukiMultiMap[k])koukiMultiMap[k]=[];koukiMultiMap[k].push(r);}
      const pk=nm+'|'+bd;if(!allByPerson[pk])allByPerson[pk]=[];allByPerson[pk].push(r);
    });
    return{zenkiMap,koukiMap,zenkiMultiMap,koukiMultiMap,allByPerson};
  }

  function findNewUserRecordByType(name, birth, tY, tM, type, maps) {
    const recs = maps.allByPerson[name + '|' + birth]; if (!recs || !recs.length) return { recs: [], isDup: false };
    const tIdx = tY * 12 + (tM - 1), sf = (type === 'zenki') ? F.K_ZENKI_START : F.K_KOUKI_START, found = [];
    recs.forEach(r => { const sv = r[sf] ? r[sf].value || '' : ''; if (!sv) return; const p = sv.split('-'); const ri = parseInt(p[0],10)*12+(parseInt(p[1],10)-1); if (Math.abs(tIdx-ri) <= UPDATE_INTERVAL) found.push(r); });
    /* フォールバック：変則的な初回レコードで、前期/後期どちらか一方の
       開始日しか入力されていない場合にも対象レコードを拾う */
    if (found.length === 0) {
      const altSf = (type === 'zenki') ? F.K_KOUKI_START : F.K_ZENKI_START;
      recs.forEach(r => {
        if (r[sf] && r[sf].value) return;
        const av = r[altSf] ? r[altSf].value || '' : '';
        if (!av) return;
        const p = av.split('-');
        const ai = parseInt(p[0], 10) * 12 + (parseInt(p[1], 10) - 1);
        if (Math.abs(tIdx - ai) <= UPDATE_INTERVAL) found.push(r);
      });
    }
    return { recs: found, isDup: found.length > 1 };
  }

  function findClosestPriorKouki(name, birth, tY, tM, maps) {
    const rs = maps.allByPerson[name + '|' + birth];
    if (!rs || !rs.length) return null;
    const tIdx = tY * 12 + (tM - 1);
    let best = null, bestIdx = -Infinity;
    rs.forEach(r => {
      const ks = r[F.K_KOUKI_START] ? r[F.K_KOUKI_START].value || '' : '';
      if (!ks) return;
      const p = ks.split('-');
      const kIdx = parseInt(p[0], 10) * 12 + (parseInt(p[1], 10) - 1);
      if (kIdx < tIdx && kIdx > bestIdx) { bestIdx = kIdx; best = r; }
    });
    return best;
  }

  function hasFileAny(recs, fc) { return recs && recs.some(r => hasFile(r, fc)); }

  function evaluateChildren(children, maps, today) {
    const cols = { prev: [], curr: [], next: [] };
    children.forEach(c => {
      const { name, kana, birth, contractDate, assigned } = c;
      const { col, type, t } = assigned;
      const targetStr = firstDateStr(t.year, t.month);
      const isNew = isFirstUpdate(contractDate, t.year, t.month);
      let keikaku = false, kondan = false, evalNew = false, errorMsg = null;

      if (isNew) {
        evalNew = true;
        const found = findNewUserRecordByType(name, birth, t.year, t.month, type, maps);
        let rec = found.recs.length ? found.recs[0] : null;
        /* フォールバック：新規判定の検索窓で見つからない場合、日付完全一致の
           マップにも該当レコードがあれば拾う */
        if (!rec) {
          const mapFallback = (type === 'zenki') ? maps.zenkiMultiMap : maps.koukiMultiMap;
          const recsFallback = mapFallback[name + '|' + birth + '|' + targetStr] || [];
          rec = recsFallback[0] || null;
        }
        if (type === 'zenki') { keikaku = hasFile(rec, F.K_ZENKI_PLAN); kondan = hasFile(rec, F.K_ZENKI_SIGNED); }
        else { keikaku = hasFile(rec, F.K_KOUKI_PLAN); kondan = hasFile(rec, F.K_KOUKI_SIGNED); }
      } else {
        if (type === 'zenki') {
          const curRecs = maps.zenkiMultiMap[name + '|' + birth + '|' + targetStr] || [];
          if (col !== 'next') { if (curRecs.length === 0) errorMsg = '6か月以内の計画が見つかりません。マネジャーに確認してください。'; else if (curRecs.length > 1) errorMsg = '計画レコードが重複しています。マネジャーに確認し不要なレコードを削除してください。'; }
          if (!errorMsg) {
            const cur = curRecs[0] || null;
            const ps = shiftMonths(t.year, t.month, -6);
            let prvRecs = maps.koukiMultiMap[name + '|' + birth + '|' + firstDateStr(ps.year, ps.month)] || [];
            /* フォールバック①：前期と後期が同一レコードに同居する変則的な
               最初のレコードに対応。6か月前ちょうどの後期レコードが
               見つからない場合、まずレコード自身の後期評価案を確認する。 */
            if (prvRecs.length === 0 && cur && hasFile(cur, F.K_KOUKI_EVAL)) { prvRecs = [cur]; }
            /* フォールバック②：それでも見つからなければ、対象月より前で
               直近の後期計画開始日を持つレコードを採用する。 */
            if (prvRecs.length === 0) {
              const fallbackPrev = findClosestPriorKouki(name, birth, t.year, t.month, maps);
              if (fallbackPrev) prvRecs = [fallbackPrev];
            }
            keikaku = KEIKAKU_REQUIRE_EVAL ? (hasFile(cur, F.K_ZENKI_PLAN) && hasFileAny(prvRecs, F.K_KOUKI_EVAL)) : hasFile(cur, F.K_ZENKI_PLAN);
            kondan = hasFile(cur, F.K_ZENKI_SIGNED) && hasFileAny(prvRecs, F.K_KOUKI_EVAL_SIGNED);
          }
        } else {
          const curRecs = maps.koukiMultiMap[name + '|' + birth + '|' + targetStr] || [];
          if (col !== 'next') { if (curRecs.length === 0) errorMsg = '6か月以内の計画が見つかりません。マネジャーに確認してください。'; else if (curRecs.length > 1) errorMsg = '計画レコードが重複しています。マネジャーに確認し不要なレコードを削除してください。'; }
          if (!errorMsg) {
            const cur = curRecs[0] || null;
            keikaku = KEIKAKU_REQUIRE_EVAL ? (hasFile(cur, F.K_KOUKI_PLAN) && hasFileAny(curRecs, F.K_ZENKI_EVAL)) : hasFile(cur, F.K_KOUKI_PLAN);
            kondan = hasFile(cur, F.K_KOUKI_SIGNED) && hasFileAny(curRecs, F.K_ZENKI_EVAL_SIGNED);
          }
        }
      }

      if (errorMsg) { cols[col].push({ name, kana, keikaku: false, kondan: false, evalNew: false, errorMsg, msgs: [], type }); return; }
      const kondanForDisplay = (col === 'next') ? null : kondan;
      const msgs = buildMessage(col, keikaku, (col === 'next') ? null : kondan, today);
      cols[col].push({ name, kana, keikaku, kondan: kondanForDisplay, evalNew, errorMsg: null, msgs, type });
    });
    return cols;
  }

  /* ===== 描画用アイコン（✅=完了 / グレー枠=未提出 / NEW=新規）===== */
  function mark(ok) { return ok ? '<span class="ipp-ok">✅</span>' : '<span class="ipp-pending"></span>'; }
  function monthLabel(t) { return t.month + '月'; }

  function buildItems(list, showKondan) {
    if (!list.length) return '<div class="ipp-empty">対象なし</div>';
    const sorted = list.slice().sort((a, b) => {
      const sa = a.errorMsg ? 0 : sortScore(a, showKondan);
      const sb = b.errorMsg ? 0 : sortScore(b, showKondan);
      if (sa !== sb) return sa - sb;
      return (a.kana || a.name).localeCompare((b.kana || b.name), 'ja');
    });
    return sorted.map(it => {
      if (it.errorMsg) return '<div class="ipp-item ipp-item-ng"><span class="ipp-name">' + escapeHtml(it.name) + '</span><span class="ipp-marks"><span class="ipp-ng">⚠️</span> ' + escapeHtml(it.errorMsg) + '</span></div>';
      const done = sortScore(it, showKondan) === 2;
      let marks = '計画' + mark(it.keikaku);
      if (showKondan) marks += ' ｜ 懇談' + mark(it.kondan);
      if (it.evalNew) marks += '<span class="ipp-new-label">NEW</span>';
      let msgsHtml = '';
      if (it.msgs && it.msgs.length) msgsHtml = it.msgs.map(m => '<div class="ipp-msg ipp-msg-' + m.level + '">' + escapeHtml(m.text) + '</div>').join('');
      return '<div class="ipp-item' + (done ? '' : ' ipp-item-ng') + '"><span class="ipp-name">' + escapeHtml(it.name) + '</span><span class="ipp-marks">' + marks + '</span>' + msgsHtml + '</div>';
    }).join('');
  }

  function renderPopup(cols, errorChildren, targets) {
    const old = document.getElementById('iroha-plan-popup-overlay'); if (old) old.remove();
    const errorsHtml = errorChildren.length
      ? '<div class="ipp-errors"><div class="ipp-errors-title">⚠️ 確認が必要な児童</div>' + errorChildren.map(e => '<div class="ipp-error-item">' + escapeHtml(e.name) + '：' + escapeHtml(e.reason) + '</div>').join('') + '</div>'
      : '';
    const overlay = document.createElement('div'); overlay.id = 'iroha-plan-popup-overlay'; overlay.className = 'ipp-overlay';
    overlay.innerHTML =
      '<div class="ipp-modal"><div class="ipp-header"><h2>📋 支援計画 更新状況</h2><button class="ipp-x" type="button">✕</button></div>' +
      '<div class="ipp-body"><div class="ipp-note">✅ は完了、□ は未提出です。色付きの行はこれから対応をお願いします。</div>' +
      '<div class="ipp-cols">' +
        '<section class="ipp-col"><h3>前月更新（' + monthLabel(targets.prev) + '）</h3>' + buildItems(cols.prev, true) + '</section>' +
        '<section class="ipp-col ipp-col-curr"><h3>今月更新（' + monthLabel(targets.curr) + '）</h3>' + buildItems(cols.curr, true) + '</section>' +
        '<section class="ipp-col"><h3>来月更新（' + monthLabel(targets.next) + '・計画のみ）</h3>' + buildItems(cols.next, false) + '</section>' +
      '</div>' + errorsHtml + '</div>' +
      '<div class="ipp-footer"><div class="ipp-snooze">' +
        '<label class="ipp-check"><input type="checkbox" id="ipp-snooze-today"> 今日は表示しない</label>' +
        '<label class="ipp-check"><input type="checkbox" id="ipp-snooze-week"> 1週間後に通知</label>' +
      '</div><button class="ipp-close-btn" type="button">閉じる</button></div></div>';
    document.body.appendChild(overlay);
    const cbToday = overlay.querySelector('#ipp-snooze-today'), cbWeek = overlay.querySelector('#ipp-snooze-week');
    cbToday.addEventListener('change', () => { if (cbToday.checked) cbWeek.checked = false; });
    cbWeek.addEventListener('change', () => { if (cbWeek.checked) cbToday.checked = false; });
    function doClose() { if (cbToday.checked) snoozeToday(); else if (cbWeek.checked) snoozeWeek(); overlay.remove(); }
    overlay.querySelector('.ipp-x').addEventListener('click', doClose);
    overlay.querySelector('.ipp-close-btn').addEventListener('click', doClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) doClose(); });
  }

  function injectStyle() {
    if (document.getElementById('iroha-plan-popup-style')) return;
    var css =
      '.ipp-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;box-sizing:border-box;}' +
      '.ipp-modal{background:#fff;border-radius:14px;width:100%;max-width:920px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);animation:ipp-pop .18s ease-out;}' +
      '@keyframes ipp-pop{from{transform:scale(.96);opacity:0;}to{transform:scale(1);opacity:1;}}' +
      '.ipp-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#5a8f5a;color:#fff;}' +
      '.ipp-header h2{margin:0;font-size:17px;font-weight:700;}' +
      '.ipp-x{background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:8px;font-size:16px;cursor:pointer;}' +
      '.ipp-body{padding:16px;overflow-y:auto;}' +
      '.ipp-note{font-size:12px;color:#888;margin:0 2px 12px;}' +
      '.ipp-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}' +
      '.ipp-col{border:1px solid #e3ebe3;border-radius:10px;padding:10px;background:#fafcfa;}' +
      '.ipp-col-curr{border-color:#5a8f5a;background:#f1f7f1;}' +
      '.ipp-col h3{margin:0 0 8px;font-size:14px;color:#3a5a3a;border-bottom:1px solid #e3ebe3;padding-bottom:6px;}' +
      '.ipp-item{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:7px;margin-bottom:6px;background:#fff;border:1px solid #eef2ee;}' +
      '.ipp-item-ng{background:#fff5f5;border-color:#ffd6d6;}' +
      '.ipp-name{font-weight:600;font-size:14px;color:#222;}' +
      '.ipp-marks{font-size:13px;color:#555;}' +
      '.ipp-ok{color:#2e9e3f;}' +
      '.ipp-pending{display:inline-block;width:13px;height:13px;border:2px solid #bbb;border-radius:3px;box-sizing:border-box;vertical-align:middle;}' +
      '.ipp-ng{color:#e03131;font-weight:700;}' +
      '.ipp-new-label{display:inline-block;background:#ff6b6b;color:#fff;font-size:10px;font-weight:800;padding:1px 5px;border-radius:3px;margin-left:3px;vertical-align:middle;letter-spacing:.5px;}' +
      '.ipp-msg{font-size:12px;margin-top:4px;padding:4px 7px;border-radius:5px;line-height:1.5;}' +
      '.ipp-msg-encourage{background:#e8f5e9;color:#2e7d32;border-left:3px solid #66bb6a;}' +
      '.ipp-msg-info{background:#e3f2fd;color:#1565c0;border-left:3px solid #64b5f6;}' +
      '.ipp-msg-warn{background:#fff8e1;color:#f57f17;border-left:3px solid #ffd54f;}' +
      '.ipp-msg-danger{background:#fce4ec;color:#b71c1c;border-left:3px solid #ef9a9a;}' +
      '.ipp-empty{color:#aaa;font-size:13px;padding:6px 2px;}' +
      '.ipp-errors{margin-top:14px;border:1px solid #ffe08a;background:#fffbe6;border-radius:10px;padding:10px 12px;}' +
      '.ipp-errors-title{font-weight:700;color:#b8860b;margin-bottom:6px;font-size:14px;}' +
      '.ipp-error-item{font-size:13px;color:#7a5d00;padding:2px 0;}' +
      '.ipp-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid #eef2ee;background:#fafcfa;flex-wrap:wrap;}' +
      '.ipp-snooze{display:flex;gap:16px;flex-wrap:wrap;}' +
      '.ipp-check{font-size:13px;color:#444;display:flex;align-items:center;gap:6px;cursor:pointer;}' +
      '.ipp-close-btn{background:#5a8f5a;color:#fff;border:none;border-radius:8px;padding:9px 22px;font-size:14px;font-weight:700;cursor:pointer;}' +
      '@media(max-width:720px){.ipp-cols{grid-template-columns:1fr;}.ipp-modal{max-height:92vh;}.ipp-footer{flex-direction:column;align-items:stretch;}.ipp-close-btn{width:100%;}}';
    var st = document.createElement('style'); st.id = 'iroha-plan-popup-style'; st.textContent = css; document.head.appendChild(st);
  }
})();
