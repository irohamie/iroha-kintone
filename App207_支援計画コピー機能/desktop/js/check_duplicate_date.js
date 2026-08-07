(() => {
  'use strict';

  // 常に編集できるフィールド
  const LOCK_EXEMPT_FIELDS = ['氏名', '前期計画開始', '後期計画開始'];
  
  // ロックする対象を「文字列1行」と「文字列複数行」に限定
  const TARGET_TYPES = ['SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT'];

  // -------------------------------------------------------------------
  // 1. 画面表示時・値の変更時のイベント
  // -------------------------------------------------------------------
  const uiEvents = [
    'app.record.create.show', 'app.record.edit.show',
    'app.record.create.change.氏名', 'app.record.create.change.前期計画開始', 'app.record.create.change.後期計画開始', 'app.record.create.change.生年月日',
    'app.record.edit.change.氏名', 'app.record.edit.change.前期計画開始', 'app.record.edit.change.後期計画開始', 'app.record.edit.change.生年月日'
  ];

  kintone.events.on(uiEvents, (event) => {
    const record = event.record;
    const name = record['氏名'].value;
    const date1 = record['前期計画開始'].value;
    const date2 = record['後期計画開始'].value;

    // --- 誕生月と前期/後期計画開始月の整合性チェック（即時反映） ---
    const monthCheck = checkMonthAlignment(record);
    record['前期計画開始'].error = monthCheck.zenkiError || null;
    record['後期計画開始'].error = monthCheck.koukiError || null;

    // 値が消されたり揃っていない場合は、即座にロックを解除
    if (!name || (!date1 && !date2)) {
      updateRecordLock(record, false);
      return event; 
    }

    const isEdit = event.type.includes('edit');
    const currentRecordId = event.recordId || kintone.app.record.getId();

    // APIで重複チェックとメッセージ判定
    checkDuplicate(name, date1, date2, isEdit, currentRecordId).then((result) => {
      // kintoneのシステムロックが完全に解除されるのを150ミリ秒待機する
      setTimeout(() => {
        const currentObj = kintone.app.record.get();
        if (!currentObj) return;

        // ロック状態に変更があった場合のみ画面を更新
        const hasChanged = updateRecordLock(currentObj.record, result.isDuplicate);
        if (hasChanged) {
          // 新たに重複判定された（ロックがかかる）時だけ警告アラートを出す
          if (result.isDuplicate) alert(result.errorMsg); 
          kintone.app.record.set(currentObj);
        }
      }, 150);
    }).catch((e) => {
      console.error(e);
    });

    return event; 
  });

  // -------------------------------------------------------------------
  // 2. 保存実行前イベント（最終防衛ライン）
  // -------------------------------------------------------------------
  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], async (event) => {
    const record = event.record;
    const name = record['氏名'].value;
    const date1 = record['前期計画開始'].value;
    const date2 = record['後期計画開始'].value;

    // --- 誕生月と前期/後期計画開始月の整合性チェック（最終防衛ライン） ---
    const monthCheck = checkMonthAlignment(record);
    if (monthCheck.zenkiError) {
      record['前期計画開始'].error = monthCheck.zenkiError;
      event.error = monthCheck.zenkiError;
    }
    if (monthCheck.koukiError) {
      record['後期計画開始'].error = monthCheck.koukiError;
      event.error = event.error ? event.error + ' / ' + monthCheck.koukiError : monthCheck.koukiError;
    }

    if (!name || (!date1 && !date2)) return event;

    const isEdit = event.type.includes('edit');
    const currentRecordId = event.recordId || kintone.app.record.getId();
    
    try {
      const result = await checkDuplicate(name, date1, date2, isEdit, currentRecordId);
      if (result.isDuplicate) {
        // 画面上部の全体エラー
        event.error = event.error ? event.error + ' / ' + result.errorMsg : result.errorMsg;
        // 重複しているフィールドの下部にも赤文字でエラーを出す
        if (result.isZenkiDup) {
          record['前期計画開始'].error = record['前期計画開始'].error
            ? record['前期計画開始'].error + ' / ' + result.errorMsg
            : result.errorMsg;
        }
        if (result.isKoukiDup) {
          record['後期計画開始'].error = record['後期計画開始'].error
            ? record['後期計画開始'].error + ' / ' + result.errorMsg
            : result.errorMsg;
        }
      }
    } catch (e) {
      event.error = 'エラーが発生しました: ' + e.message;
    }
    return event;
  });

  // -------------------------------------------------------------------
  // 共通関数
  // -------------------------------------------------------------------

  // 誕生月を基準に、前期/後期計画開始の月が正しい半期に収まっているかをチェックする関数
  //
  // ルール:
  //   前期計画開始 → 誕生月の1日 ～ 6か月後まで（誕生月を含む6か月間）
  //   後期計画開始 → 誕生月の6か月後の1日 ～ さらに6か月後まで（残りの6か月間）
  //
  // ※ 新規利用・利用中断からの再開等で誕生月とぴったり一致しない場合でも、
  //    上記の半期の範囲内であれば許可する（完全一致は必須としない）
  function checkMonthAlignment(record) {
    const result = { zenkiError: '', koukiError: '' };

    const birthField = record['生年月日'];
    const birthValue = birthField && birthField.value;
    if (!birthValue) return result; // 生年月日が未入力の場合はチェック対象外

    const birthMonth = parseInt(birthValue.split('-')[1], 10);
    if (!birthMonth) return result;

    const date1 = record['前期計画開始'] && record['前期計画開始'].value;
    const date2 = record['後期計画開始'] && record['後期計画開始'].value;

    const addMonths = (month, add) => ((month - 1 + add) % 12) + 1;

    if (date1) {
      const month1 = parseInt(date1.split('-')[1], 10);
      const diff1 = (month1 - birthMonth + 12) % 12;
      // 0〜5なら前期の正しい範囲。6以上（=本来は後期の範囲）ならエラー
      if (diff1 > 5) {
        const frontEnd = addMonths(birthMonth, 5);
        result.zenkiError = `前期計画開始は誕生月(${birthMonth}月)から6か月以内（${birthMonth}月〜${frontEnd}月）の月にしてください`;
      }
    }

    if (date2) {
      const month2 = parseInt(date2.split('-')[1], 10);
      const diff2 = (month2 - birthMonth + 12) % 12;
      // 6〜11なら後期の正しい範囲。5以下（=本来は前期の範囲）ならエラー
      if (diff2 < 6) {
        const backStart = addMonths(birthMonth, 6);
        const backEnd = addMonths(birthMonth, 11);
        result.koukiError = `後期計画開始は誕生月の6か月後（${backStart}月）から6か月以内（${backStart}月〜${backEnd}月）の月にしてください`;
      }
    }

    return result;
  }

  // 重複チェックとエラーメッセージの判定を行う関数
  async function checkDuplicate(name, date1, date2, isEdit, recordId) {
    let dateQueries = [];
    if (date1) dateQueries.push(`前期計画開始 = "${date1}"`);
    if (date2) dateQueries.push(`後期計画開始 = "${date2}"`);
    
    let query = `氏名 = "${name}" and (${dateQueries.join(' or ')})`;
    if (isEdit && recordId) {
      query += ` and $id != "${recordId}"`;
    }

    const resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
      app: kintone.app.getId(),
      query: query 
    });

    let isZenkiDup = false;
    let isKoukiDup = false;

    // 取得した既存レコードの中身を見て、どちらの日付が重複しているか判定
    resp.records.forEach(r => {
      if (date1 && r['前期計画開始'].value === date1) isZenkiDup = true;
      if (date2 && r['後期計画開始'].value === date2) isKoukiDup = true;
    });

    // 3パターンのエラーメッセージ出し分け
    let errorMsg = '';
    if (isZenkiDup && isKoukiDup) {
      errorMsg = '前期と後期の日付を変更してください。この氏名と計画開始日の組み合わせは既に登録されています。';
    } else if (isZenkiDup) {
      errorMsg = '前期の日付を変更してください。この氏名と計画開始日の組み合わせは既に登録されています。';
    } else if (isKoukiDup) {
      errorMsg = '後期の日付を変更してください。この氏名と計画開始日の組み合わせは既に登録されています。';
    }

    return {
      isDuplicate: isZenkiDup || isKoukiDup,
      isZenkiDup: isZenkiDup,
      isKoukiDup: isKoukiDup,
      errorMsg: errorMsg
    };
  }
  
  // レコードの対象フィールドをロック（グレーアウト）する関数
  function updateRecordLock(record, isDuplicate) {
    let hasChanged = false;
    for (let key in record) {
      if (LOCK_EXEMPT_FIELDS.includes(key)) continue;
      
      const field = record[key];
      if (field && TARGET_TYPES.includes(field.type)) {
        if (field.disabled !== isDuplicate) {
          field.disabled = isDuplicate;
          hasChanged = true;
        }
      }
    }
    return hasChanged;
  }

})();