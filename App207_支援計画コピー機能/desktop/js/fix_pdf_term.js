(() => {
  'use strict';

  // -------------------------------------------------------------------
  // 1. 各ツールの設定定義
  // -------------------------------------------------------------------
  
  const PDF_FIELD_MAP = {
    '前期案': '案', '後期案': '案',
    '前期計画': '計画', '後期計画': '計画',
    '前期サイン済': 'サイン済', '後期サイン済': 'サイン済',
    '前期評価案': '評価案', '後期評価案': '評価案',
    '前期評価': '評価', '後期評価': '評価',
    '前期評価サイン済': '評価サイン済', '後期評価サイン済': '評価サイン済'
  };

  const SIGN_FIELDS = [
    '前期立案署名', '前期評価署名', '後期立案署名', '後期評価署名'
  ];

  const getApiBase = () => {
    const m = location.pathname.match(/^\/k\/guest\/(\d+)\//);
    return m ? `/k/guest/${m[1]}` : '/k';
  };

  // -------------------------------------------------------------------
  // ファイル名の「期」「種類」「日付(+6ヶ月/-6ヶ月)」を自動変換するヘルパー関数
  // -------------------------------------------------------------------
  const generateNewName = (oldName, currentTerm, targetTerm, targetType) => {
    // 1. 「前期 / 後期」の置き換え
    let newName = oldName.replace(/前期|後期/g, targetTerm);
    
    // 2. 「立案 / 評価」の置き換え（サイン移動時のみ）
    if (targetType) {
      newName = newName.replace(/立案|評価/g, targetType);
    }

    // 3. 日付の6ヶ月シフト処理
    const dateRegex = /(\d{4})-(\d{2})-(\d{2})/;
    const match = newName.match(dateRegex);
    
    if (match) {
      let year = parseInt(match[1], 10);
      let month = parseInt(match[2], 10) - 1; // JSの月は0~11
      let day = parseInt(match[3], 10);
      
      let d = new Date(year, month, day);
      
      // 前期→後期なら +6ヶ月、後期→前期なら -6ヶ月
      if (currentTerm === '前期' && targetTerm === '後期') {
        d.setMonth(d.getMonth() + 6);
      } else if (currentTerm === '後期' && targetTerm === '前期') {
        d.setMonth(d.getMonth() - 6);
      }
      
      // YYYY-MM-DD 形式にフォーマットし直す
      let newYear = d.getFullYear();
      let newMonth = String(d.getMonth() + 1).padStart(2, '0');
      let newDay = String(d.getDate()).padStart(2, '0');
      let newDateStr = `${newYear}-${newMonth}-${newDay}`;
      
      newName = newName.replace(dateRegex, newDateStr);
    }
    
    return newName;
  };


  // -------------------------------------------------------------------
  // 2. モーダルUIの生成と表示
  // -------------------------------------------------------------------
  const showToolModal = (mode) => {
    const record = kintone.app.record.get().record;
    
    let title, description;
    if (mode === 'pdf') {
      title = 'PDF 前期/後期 入替ツール';
      description = '正しい期へ移動し、ファイル名の日付も自動で6ヶ月前後させます。';
    } else if (mode === 'sign') {
      title = '署名 自由移動ツール';
      description = 'ドロップダウンで移動先を選び、画像を正しいフィールドへ移動させます。';
    } else if (mode === 'rename') {
      title = 'ファイル名 変更ツール';
      description = 'テキストボックスでファイル名を直接編集し、保存し直します。';
    }

    let el = document.getElementById('tool_modal_v5');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tool_modal_v5';
      el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:20px;';
      document.body.appendChild(el);
    }

    let fileListHtml = '';
    let hasFiles = false;

    if (mode === 'pdf') {
      // --- 【PDFモード】 前期と後期を行き来する ---
      Object.keys(PDF_FIELD_MAP).forEach(fieldCode => {
        const field = record[fieldCode];
        if (field && field.value && field.value.length > 0) {
          field.value.forEach(f => {
            if (f.name.toLowerCase().endsWith('.pdf')) {
              hasFiles = true;
              const currentTerm = fieldCode.includes('前期') ? '前期' : '後期';
              const targetTerm = currentTerm === '前期' ? '後期' : '前期';
              const targetField = targetTerm + PDF_FIELD_MAP[fieldCode];
              
              fileListHtml += `
                <div style="background:#f8f9fa; border:1px solid #ddd; padding:12px; border-radius:6px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:15px;">
                  <div style="flex:1; overflow:hidden;">
                    <span style="font-size:11px; background:#e0e0e0; padding:3px 8px; border-radius:4px; color:#555; font-weight:bold;">現在: ${fieldCode}</span><br>
                    <strong style="font-size:14px; color:#333; word-break:break-all; display:inline-block; margin-top:5px;">${f.name}</strong>
                  </div>
                  <div style="flex-shrink:0;">
                    <button class="tool-exec-btn-pdf" 
                      data-filekey="${f.fileKey}" data-oldname="${f.name}" data-contenttype="${f.contentType}" 
                      data-currentfield="${fieldCode}" data-targetfield="${targetField}" data-targetterm="${targetTerm}" data-currentterm="${currentTerm}"
                      style="background:#9b59b6; color:#fff; border:none; padding:10px 14px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:13px;">
                      【${targetTerm}】へ移動
                    </button>
                  </div>
                </div>
              `;
            }
          });
        }
      });
    } else if (mode === 'sign') {
      // --- 【サインモード】 自由に移動する ---
      SIGN_FIELDS.forEach(fieldCode => {
        const field = record[fieldCode];
        if (field && field.value && field.value.length > 0) {
          field.value.forEach(f => {
            hasFiles = true;
            let optionsHtml = '';
            SIGN_FIELDS.forEach(targetField => {
              if (targetField !== fieldCode) optionsHtml += `<option value="${targetField}">${targetField}</option>`;
            });

            fileListHtml += `
              <div style="background:#f8f9fa; border:1px solid #ddd; padding:12px; border-radius:6px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="flex:1; min-width:180px; overflow:hidden;">
                  <span style="font-size:11px; background:#e0e0e0; padding:3px 8px; border-radius:4px; color:#555; font-weight:bold;">現在: ${fieldCode}</span><br>
                  <strong style="font-size:13px; color:#333; word-break:break-all; display:inline-block; margin-top:5px;">${f.name}</strong>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
                  <select id="sign_target_${f.fileKey}" style="padding:6px 10px; border-radius:4px; border:1px solid #ccc; font-size:13px;">
                    ${optionsHtml}
                  </select>
                  <button class="tool-exec-btn-sign" 
                    data-filekey="${f.fileKey}" data-oldname="${f.name}" data-contenttype="${f.contentType}" data-currentfield="${fieldCode}" 
                    style="background:#9b59b6; color:#fff; border:none; padding:8px 12px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:13px;">
                    移動
                  </button>
                </div>
              </div>
            `;
          });
        }
      });
    } else if (mode === 'rename') {
      // --- 【名前変更モード】 同じフィールド内でファイル名を直接変更 ---
      Object.keys(PDF_FIELD_MAP).forEach(fieldCode => {
        const field = record[fieldCode];
        if (field && field.value && field.value.length > 0) {
          field.value.forEach(f => {
            if (f.name.toLowerCase().endsWith('.pdf')) {
              hasFiles = true;
              fileListHtml += `
                <div style="background:#f8f9fa; border:1px solid #ddd; padding:12px; border-radius:6px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                  <div style="flex:1; min-width:200px; overflow:hidden;">
                    <span style="font-size:11px; background:#e0e0e0; padding:3px 8px; border-radius:4px; color:#555; font-weight:bold;">現在: ${fieldCode}</span><br>
                    <input type="text" id="rename_input_${f.fileKey}" value="${f.name}" style="width:100%; padding:8px; margin-top:5px; border:1px solid #ccc; border-radius:4px; font-size:13px; box-sizing:border-box;">
                  </div>
                  <div style="flex-shrink:0; padding-top:18px;">
                    <button class="tool-exec-btn-rename" 
                      data-filekey="${f.fileKey}" data-oldname="${f.name}" data-contenttype="${f.contentType}" data-currentfield="${fieldCode}" 
                      style="background:#9b59b6; color:#fff; border:none; padding:10px 14px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:13px;">
                      保存
                    </button>
                  </div>
                </div>
              `;
            }
          });
        }
      });
    }

    if (!hasFiles) {
      fileListHtml = `<p style="text-align:center; color:#666; padding:20px;">対象のファイルがありません。</p>`;
    }

    el.innerHTML = `
      <div style="background:#fff; padding:25px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.3); width:100%; max-width:600px; max-height:85vh; display:flex; flex-direction:column;">
        <h3 style="margin-top:0; color:#2c3e50; border-bottom:2px solid #9b59b6; padding-bottom:10px;">${title}</h3>
        <p style="font-size:13px; color:#666; margin-bottom:15px; line-height:1.5;">${description}</p>
        
        <div style="flex:1; overflow-y:auto; margin-bottom:20px; padding-right:5px;">
          ${fileListHtml}
        </div>
        
        <div id="tool_loading" style="display:none; text-align:center; padding:15px 0;">
          <div style="border:4px solid #f3f3f3;border-top:4px solid #9b59b6;border-radius:50%;width:35px;height:35px;animation:spin 1s linear infinite;margin:0 auto 10px;"></div>
          <p style="font-size:13px; color:#666; margin:0;">ファイルの更新処理中...</p>
        </div>
        
        <button id="tool_close" style="width:100%; padding:14px; background:#eee; color:#555; border:none; border-radius:8px; font-size:15px; font-weight:bold; cursor:pointer;">閉じる</button>
      </div>
      <style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
    `;

    document.getElementById('tool_close').onclick = () => el.remove();

    // 【PDF用】アクション
    el.querySelectorAll('.tool-exec-btn-pdf').forEach(btn => {
      btn.onclick = async function() {
        const fileKey = this.getAttribute('data-filekey');
        const oldName = this.getAttribute('data-oldname');
        const contentType = this.getAttribute('data-contenttype');
        const currentField = this.getAttribute('data-currentfield');
        const targetField = this.getAttribute('data-targetfield');
        const targetTerm = this.getAttribute('data-targetterm');
        const currentTerm = this.getAttribute('data-currentterm');

        // ヘルパー関数で日付シフトも込みの新しいファイル名を生成
        const newName = generateNewName(oldName, currentTerm, targetTerm, null);

        if (!confirm(`以下の修正を実行しますか？\n\n【移動先】${targetField}\n【新ファイル名】${newName}`)) return;
        startLoading(el);
        await executeFileUpdate(fileKey, newName, contentType, currentField, targetField);
      };
    });

    // 【サイン用】アクション
    el.querySelectorAll('.tool-exec-btn-sign').forEach(btn => {
      btn.onclick = async function() {
        const fileKey = this.getAttribute('data-filekey');
        const oldName = this.getAttribute('data-oldname');
        const contentType = this.getAttribute('data-contenttype');
        const currentField = this.getAttribute('data-currentfield');
        
        const targetField = document.getElementById(`sign_target_${fileKey}`).value;
        const currentTerm = currentField.includes('前期') ? '前期' : '後期';
        const targetTerm = targetField.includes('前期') ? '前期' : '後期';
        const targetType = targetField.includes('立案') ? '立案' : '評価';

        // ヘルパー関数で日付シフトも込みの新しいファイル名を生成
        const newName = generateNewName(oldName, currentTerm, targetTerm, targetType);

        if (!confirm(`以下の修正を実行しますか？\n\n【移動先】${targetField}\n【新ファイル名】${newName}`)) return;
        startLoading(el);
        await executeFileUpdate(fileKey, newName, contentType, currentField, targetField);
      };
    });

    // 【名前変更用】アクション
    el.querySelectorAll('.tool-exec-btn-rename').forEach(btn => {
      btn.onclick = async function() {
        const fileKey = this.getAttribute('data-filekey');
        const oldName = this.getAttribute('data-oldname');
        const contentType = this.getAttribute('data-contenttype');
        const currentField = this.getAttribute('data-currentfield');
        
        let newName = document.getElementById(`rename_input_${fileKey}`).value.trim();
        
        if (!newName) return alert('ファイル名を入力してください。');
        if (newName === oldName) return alert('ファイル名が変更されていません。');
        if (!newName.toLowerCase().endsWith('.pdf')) newName += '.pdf';

        if (!confirm(`以下の名前に変更しますか？\n\n【新ファイル名】${newName}`)) return;
        startLoading(el);
        await executeFileUpdate(fileKey, newName, contentType, currentField, currentField);
      };
    });
  };

  const startLoading = (modalEl) => {
    modalEl.querySelectorAll('button').forEach(b => b.disabled = true);
    document.getElementById('tool_loading').style.display = 'block';
  };

  // -------------------------------------------------------------------
  // 3. ダウンロード・アップロード・レコード更新の統合処理
  // -------------------------------------------------------------------
  const executeFileUpdate = async (fileKey, newName, contentType, currentField, targetField) => {
    try {
      const apiBase = getApiBase();
      const head = {"X-Requested-With": "XMLHttpRequest"};

      // 1. ダウンロード
      const fileBuffer = await fetch(apiBase + "/v1/file.json?fileKey=" + fileKey, {headers: head}).then(r => r.arrayBuffer());

      // 2. アップロード
      const fd = new FormData();
      fd.append('file', new Blob([fileBuffer], {type: contentType}), newName);
      fd.append('__REQUEST_TOKEN__', kintone.getRequestToken());
      const upResp = await fetch(apiBase + "/v1/file.json", { method: 'POST', headers: head, body: fd }).then(r => r.json());
      const newFileKey = upResp.fileKey;

      // 3. レコード更新
      const currentRecord = kintone.app.record.get().record;
      let recordUpdate = {};

      if (currentField === targetField) {
        // フィールド移動なし（名前変更のみ）
        const newValue = (currentRecord[currentField].value || [])
          .filter(f => f.fileKey !== fileKey)
          .map(f => ({fileKey: f.fileKey}));
        newValue.push({fileKey: newFileKey});
        recordUpdate[currentField] = { value: newValue };
      } else {
        // フィールド移動あり
        const oldFieldValue = (currentRecord[currentField].value || [])
          .filter(f => f.fileKey !== fileKey)
          .map(f => ({fileKey: f.fileKey}));
        recordUpdate[currentField] = { value: oldFieldValue };

        const targetFieldValue = (currentRecord[targetField].value || []).map(f => ({fileKey: f.fileKey}));
        targetFieldValue.push({fileKey: newFileKey});
        recordUpdate[targetField] = { value: targetFieldValue };
      }

      await kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', {
        app: kintone.app.getId(),
        id: kintone.app.record.getId(),
        record: recordUpdate
      });

      location.reload();
    } catch (e) {
      alert('エラーが発生しました: ' + e.message);
      const modal = document.getElementById('tool_modal_v5');
      if (modal) modal.remove();
    }
  };

  // -------------------------------------------------------------------
  // 4. ボタンの配置（詳細画面の fix スペース）
  // -------------------------------------------------------------------
  kintone.events.on(['app.record.detail.show'], (ev) => {
    const fixSpace = kintone.app.record.getSpaceElement('fix');
    
    if (fixSpace && !document.getElementById('tool_btn_container')) {
      const container = document.createElement('div');
      container.id = 'tool_btn_container';
      container.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

      const btnStyle = 'padding:8px 16px; background-color:#9b59b6; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer; font-size:14px; box-shadow:0 2px 4px rgba(0,0,0,0.1); width:100%;';

      const pdfBtn = document.createElement('button');
      pdfBtn.innerText = '前期/後期入替';
      pdfBtn.style.cssText = btnStyle;
      pdfBtn.onclick = () => showToolModal('pdf');

      const signBtn = document.createElement('button');
      signBtn.innerText = 'サイン入替';
      signBtn.style.cssText = btnStyle;
      signBtn.onclick = () => showToolModal('sign');

      const renameBtn = document.createElement('button');
      renameBtn.innerText = 'ファイル名変更';
      renameBtn.style.cssText = btnStyle;
      renameBtn.onclick = () => showToolModal('rename');

      container.appendChild(pdfBtn);
      container.appendChild(signBtn);
      container.appendChild(renameBtn);
      fixSpace.appendChild(container);
    }

    return ev;
  });

})();