/* =====================================================================
 * app10_karte_panel.js — アプリ10(利用者リスト)詳細画面のパネル
 *
 * 搭載先: アプリ10 のみ / 読み込み順: karte_core.js の後
 *
 * 必要なスペースフィールド(アプリ10のフォームに手動配置)
 *   karte_att_cal     … 出欠カレンダー
 *   karte_karte_list  … カルテ一覧(出席分のみ・月送り)
 *   ※片方だけ設置していても動作する
 *
 * 設計書 §3.6 に対応(参照先はアプリ11)
 *
 * 【出欠カレンダー】
 *  ・当月を 1〜15日 / 16〜31日 の2行で表示。各マスに日付+曜日+状態アイコン
 *  ・事前欠席=オレンジ / 直近欠席=赤 で色分け
 *  ・◀前月 / 翌月▶ / 今月
 *  ・マスタップで作成チェックと同一の詳細ポップアップ
 *  ・普段の利用曜日でない日は、警告の上で続行できる
 *
 * 【カルテ一覧】
 *  ・出席分のみ。月日 / メニュー / 個別SV / 保護者
 *  ・月単位の送り(◀前月 / 翌月▶ / 今月)
 *  ・行タップでアプリ11の編集画面を別タブで開く
 * =================================================================== */
(function () {
  'use strict';
  const C = KARTE.CONFIG, F = C.F, K = C.KIND, U = KARTE.util, A = KARTE.api, h = KARTE.h;
  const CE = KARTE.checkEngine;

  const CAL_ELEMENT_ID = 'karte_att_cal';
  const LIST_ELEMENT_ID = 'karte_karte_list';

  // マスタ/設定レコードはアプリ11にあるため、参照先を明示する
  // (karte_core.js の既定でもアプリ11だが、意図を明示するために呼んでおく)
  KARTE.setMasterAppId(C.APP11_ID);

  const calCtx = { month: U.thisMonthStr(), monthlies: {}, results: [], holidays: null };
  const listCtx = { month: U.thisMonthStr() };

  /* ================= 起動 ================= */
  kintone.events.on(
    ['app.record.detail.show', 'mobile.app.record.detail.show'],
    async function (event) {
      const getSpace = (kintone.app.record && kintone.app.record.getSpaceElement) ||
        (kintone.mobile && kintone.mobile.app.record && kintone.mobile.app.record.getSpaceElement);
      if (!getSpace) return event;

      const child = childFromRecord(event.record);

      const calSpace = getSpace(CAL_ELEMENT_ID);
      if (calSpace) {
        calSpace.innerHTML = '';
        const el = h('div', { class: 'karte-att-cal' });
        calSpace.appendChild(el);
        calCtx.month = U.thisMonthStr();
        await drawCalendar(el, child);
      }

      const listSpace = getSpace(LIST_ELEMENT_ID);
      if (listSpace) {
        listCtx.month = U.thisMonthStr();
        await drawList(listSpace, child);
      }
      return event;
    }
  );

  function childFromRecord(rec) {
    const a = C.A10;
    const get = (code) => (rec[code] ? rec[code].value : '');
    return {
      id: Number(rec.$id.value),
      name: get(a.name) || '',
      kana: get(a.kana) || '',
      office: get(a.office) || '',
      days: get(a.days) || [],
      time: get(a.time) || '',
      stage: get(a.stage) || '',
      grade: get(a.grade) || '',
      status: get(a.status) || '',
      contract: get(a.contract) || '',
    };
  }

  /* ===================================================================
   * 出欠カレンダー
   * =================================================================== */
  async function drawCalendar(root, child) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'ac-status' }, '読み込み中…'));
    try {
      const dates = U.datesOfMonth(calCtx.month);
      const mr = U.monthRange(calCtx.month);
      const q = KARTE.karteQuery() +
        ' and ' + F.name + ' = "' + String(child.name).replace(/"/g, '') + '"' +
        ' and ' + F.date + ' >= "' + mr.start + '" and ' + F.date + ' <= "' + mr.end + '"';
      const fields = ['$id', F.date, F.time, F.office, F.name, F.kana, F.attend, F.absentReason, F.table];

      const got = await Promise.all([
        KARTE.master.holidays(),
        CE.loadExcludedMap(dates),
        KARTE.master.cutover(),
        KARTE.master.quality(),
        A.fetchAll(C.APP11_ID, q, fields),
      ]);
      const holidays = got[0];
      calCtx.holidays = holidays;
      calCtx.monthlies = got[1].monthlies;
      const excludedMap = got[1].excludedMap;
      const cutover = got[2], quality = got[3], records = got[4];

      // この児童1人分だけを判定する
      const nameIndex = CE.buildNameIndex([child]);
      const slots = CE.buildExpectedSlots({
        children: [child], holidays: holidays, office: '', dates: dates,
      });
      const ev = CE.evaluate({
        records: records, slots: slots, excludedMap: excludedMap,
        cutover: cutover, quality: quality, office: '', nameIndex: nameIndex,
      });
      calCtx.results = ev.results;

      renderCalendar(root, child, dates, holidays);
    } catch (e) {
      console.error(e);
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'ac-status ac-status-err' }, 'エラー: ' + (e.message || e)));
    }
  }

  function renderCalendar(root, child, dates, holidays) {
    const byDate = {};
    calCtx.results.forEach((r) => { byDate[r.date] = r; });

    root.innerHTML = '';
    root.appendChild(h('div', { class: 'ac-head' },
      h('button', { class: 'ac-navbtn', onclick: () => shiftCalMonth(-1, root, child) }, '◀'),
      h('span', { class: 'ac-month' }, calCtx.month.replace('-', '年') + '月'),
      h('button', { class: 'ac-navbtn', onclick: () => shiftCalMonth(1, root, child) }, '▶'),
      h('button', {
        class: 'ac-navbtn ac-today',
        onclick: () => { calCtx.month = U.thisMonthStr(); drawCalendar(root, child); },
      }, '今月')));

    // 1〜15日を1行目、16日〜月末を2行目の固定2行構成
    const chunks = [dates.slice(0, 15), dates.slice(15)].filter((r) => r.length);
    const grid = h('div', { class: 'ac-grid' });
    chunks.forEach((rowDates) => {
      const rowEl = h('div', {
        class: 'ac-row',
        style: 'grid-template-columns: repeat(' + rowDates.length + ', 1fr);',
      });
      rowDates.forEach((ds) => rowEl.appendChild(dayCell(ds, byDate[ds], child, holidays, root)));
      grid.appendChild(rowEl);
    });
    root.appendChild(grid);

    root.appendChild(h('div', { class: 'ac-legend' },
      h('span', null, '✅完了 ❌未作成 ⚠️不備 🔁重複 🟡注意'),
      h('span', { class: 'ac-legend-abspre' }, '🏠事前欠席'),
      h('span', { class: 'ac-legend-absday' }, '🏠直近欠席'),
      h('span', null, 'ℹ️予定外 ➖対象外')));
  }

  function dayCell(dateStr, result, child, holidays, root) {
    const d = U.parseDate(dateStr);
    const wd = U.weekdayJa(dateStr);
    const isHol = holidays && holidays.has(dateStr);
    const isToday = dateStr === U.todayStr();
    const cls = 'ac-cell' + (isHol ? ' ac-hol' : '') + (isToday ? ' ac-today-cell' : '') +
      (wd === '土' ? ' ac-sat' : (wd === '日' ? ' ac-sun' : ''));
    const cell = h('div', { class: cls });
    cell.appendChild(h('div', { class: 'ac-daynum' },
      h('span', { class: 'ac-daynum-n' }, String(d.getDate())),
      h('span', { class: 'ac-wd' }, wd)));

    if (result) {
      const st = CE.STATUS[result.status];
      cell.classList.add('ac-' + result.status);
      cell.appendChild(h('div', { class: 'ac-icon' }, st.icon));
      cell.title = child.name + ' ' + dateStr + '\n' + st.label + (result.detail ? '\n' + result.detail : '');
      cell.onclick = () => {
        CE.openDetail(result, {
          children: [child], monthlies: calCtx.monthlies,
          onChanged: () => drawCalendar(root, child),
        });
      };
    } else {
      // 予定に無い日(利用曜日外・祝日・契約日前など)。警告の上で続行できるようにする。
      cell.classList.add('ac-off');
      cell.onclick = () => onOffDayClick(dateStr, child, root);
    }
    return cell;
  }

  function onOffDayClick(dateStr, child, root) {
    const wd = U.weekdayJa(dateStr);
    const reasons = [];
    if (child.days.indexOf(wd) < 0) reasons.push('利用曜日(' + (child.days.length ? child.days.join('・') : '未設定') + ')に含まれない');
    if (calCtx.holidays && calCtx.holidays.has(dateStr)) reasons.push('休業日として登録されている');
    if (child.contract && dateStr < child.contract) reasons.push('契約日(' + child.contract + ')より前');

    if (!confirm(
      dateStr + '(' + wd + ')は、この児童の予定日ではありません。\n' +
      (reasons.length ? '理由: ' + reasons.join(' / ') + '\n' : '') +
      '\nそれでもこの日の記録(欠席など)を行いますか?'
    )) return;

    // 予定に無い日なので判定結果を仮に作って共通ポップアップへ渡す
    const synth = {
      childId: child.id, name: child.name, kana: child.kana, office: child.office,
      stage: child.stage, grade: child.grade,
      date: dateStr, time: U.normHM(child.time) || '00:00',
      status: 'none', detail: '', recordId: null,
    };
    CE.openDetail(synth, {
      children: [child], monthlies: calCtx.monthlies,
      onChanged: () => drawCalendar(root, child),
    });
  }

  function shiftCalMonth(delta, root, child) {
    calCtx.month = U.addMonths(calCtx.month, delta);
    drawCalendar(root, child);
  }

  /* ===================================================================
   * カルテ一覧(出席分のみ・月単位の送り)
   * =================================================================== */
  async function drawList(space, child) {
    space.innerHTML = '';
    space.appendChild(h('div', { class: 'ac-status' }, '読み込み中…'));
    try {
      const mr = U.monthRange(listCtx.month);
      const q = KARTE.karteQuery() +
        ' and ' + F.name + ' = "' + String(child.name).replace(/"/g, '') + '"' +
        ' and ' + F.attend + ' in ("' + C.ATTEND.present + '")' +
        ' and ' + F.date + ' >= "' + mr.start + '" and ' + F.date + ' <= "' + mr.end + '"' +
        ' order by ' + F.date + ' asc, ' + F.time + ' asc';
      const fields = ['$id', F.date, F.menu, F.personalNote, F.parentInfo, F.files];
      const records = await A.fetchSome(C.APP11_ID, q, fields);

      space.innerHTML = '';
      space.appendChild(monthNav(space, child));

      if (!records.length) {
        space.appendChild(h('div', { class: 'ac-status' }, 'この月の出席カルテはありません。'));
        return;
      }

      const table = h('table', { class: 'karte-klist' });
      const cg = h('colgroup');
      ['kl-date', 'kl-menu', 'kl-note', 'kl-parent'].forEach((c) => cg.appendChild(h('col', { class: c })));
      table.appendChild(cg);
      table.appendChild(h('thead', null, h('tr', null,
        h('th', null, '月日'), h('th', null, 'メニュー'), h('th', null, '個別SV'), h('th', null, '保護者'))));

      const tb = h('tbody');
      records.forEach((r) => {
        const d = U.parseDate(r[F.date].value);
        const md = d ? (d.getMonth() + 1) + '/' + d.getDate() : r[F.date].value;
        const files = (r[F.files] && r[F.files].value) || [];
        const tr = h('tr', { class: 'kl-row', title: 'タップで編集画面を開く' },
          h('td', { class: 'kl-date' }, md, files.length ? h('span', { title: '添付あり' }, '📎') : null),
          h('td', { class: 'kl-menu' }, r[F.menu] ? r[F.menu].value || '' : ''),
          h('td', { class: 'kl-text' }, r[F.personalNote] ? r[F.personalNote].value || '' : ''),
          h('td', { class: 'kl-text' }, r[F.parentInfo] ? r[F.parentInfo].value || '' : ''));
        tr.onclick = ((id) => () => CE.openRecordEdit(id, true))(r.$id.value);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      space.appendChild(h('div', { class: 'karte-klist-wrap' }, table));
    } catch (e) {
      console.error(e);
      space.innerHTML = '';
      space.appendChild(h('div', { class: 'ac-status ac-status-err' }, 'エラー: ' + (e.message || e)));
    }
  }

  function monthNav(space, child) {
    return h('div', { class: 'kl-pager' },
      h('button', {
        class: 'ac-navbtn',
        onclick: () => { listCtx.month = U.addMonths(listCtx.month, -1); drawList(space, child); },
      }, '◀ 前月'),
      h('span', { class: 'kl-pageinfo' }, listCtx.month.replace('-', '年') + '月'),
      h('button', {
        class: 'ac-navbtn',
        onclick: () => { listCtx.month = U.addMonths(listCtx.month, 1); drawList(space, child); },
      }, '翌月 ▶'),
      h('button', {
        class: 'ac-navbtn ac-today',
        onclick: () => { listCtx.month = U.thisMonthStr(); drawList(space, child); },
      }, '今月'));
  }
})();
