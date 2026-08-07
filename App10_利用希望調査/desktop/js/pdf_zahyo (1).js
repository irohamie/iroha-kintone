(() => {
  'use strict';

  // ===== 設定：原本PDFが置かれている場所 =====
  const MASTER_APP_ID = 10;      
  const MASTER_RECORD_ID = 441;  

  const FIELDS = {
    masterPdfTamaki: '契約書原本玉城',
    masterPdfMeiwa:  '契約書原本明和',
    coordsData:      '座標設定データ', 
    savePdf:         '契約書',
    parentText:      '契約保護者氏名',
    date:            '契約日',
    address:         '住所',
    childName:       '児童氏名',
    signature:       '利用者サイン',
    kakaritsuke:     'かかりつけ',
    shinryoka:       '診療科',
    shuji:           '主治医',
    hospAddress:     '病院住所',
    hospTel:         '病院電話',
    emgName1:        '緊急1氏名',
    emgRel1:         '緊急続柄1',
    emgAddr1:        '緊急住所1',
    emgTel1:         '緊急1TEL',
    parentRel:       '契約保護者続柄'
  };

  // シミュレーター上の表示名のみ変更
  const fieldLabels = {
    parentText: '保護者氏名', childName: '児童氏名', date: '契約日',
    address: '住所', signature: 'サイン', kakaritsuke: 'かかりつけ',
    shinryoka: '診療科', shuji: '主治医', hospAddress: '病院住所',
    hospTel: '病院電話', emgName1: '緊急氏名', emgRel1: '緊急続柄',
    emgAddr1: '緊急住所', emgTel1: '緊急電話', parentRel: '保護者続柄'
  };

  // ===== 初期座標設定 =====
  const DEFAULT_COORDS = {
    "tamaki": {
      "p1": { "parentText": { "x": 80, "y": 732 }, "childName": { "x": 292, "y": 715 }, "date": { "x": 245, "y": 562 } },
      "p4": { "date": { "x": 150, "y": 495 }, "address": { "x": 145, "y": 320 }, "signature": { "x": 150, "y": 267.8 }, "childName": { "x": 150, "y": 233 } },
      "p8": { "kakaritsuke": { "x": 165, "y": 442 }, "shinryoka": { "x": 457, "y": 442 }, "shuji": { "x": 165, "y": 424 }, "hospAddress": { "x": 165, "y": 407 }, "hospTel": { "x": 165, "y": 389 }, "emgName1": { "x": 168, "y": 355 }, "emgRel1": { "x": 458, "y": 355 }, "emgAddr1": { "x": 168, "y": 337 }, "emgTel1": { "x": 168, "y": 319 } },
      "p10": { "date": { "x": 420, "y": 790 }, "address": { "x": 205, "y": 418 }, "signature": { "x": 195, "y": 357.8 }, "parentRel": { "x": 210, "y": 335 }, "childName": { "x": 205, "y": 273 } },
      "p11": { "date": { "x": 110, "y": 251 }, "address": { "x": 280, "y": 165 }, "signature": { "x": 280, "y": 110 }, "childName": { "x": 280, "y": 95 } }
    },
    "meiwa": {
      "p1": { "parentText": { "x": 80, "y": 708 }, "childName": { "x": 292, "y": 691 }, "date": { "x": 245, "y": 527 } },
      "p4": { "date": { "x": 150, "y": 470 }, "address": { "x": 145, "y": 289 }, "signature": { "x": 150, "y": 232 }, "childName": { "x": 150, "y": 197 } },
      "p8": { "kakaritsuke": { "x": 167, "y": 410 }, "shinryoka": { "x": 457, "y": 410 }, "shuji": { "x": 167, "y": 392 }, "hospAddress": { "x": 167, "y": 375 }, "hospTel": { "x": 167, "y": 357 }, "emgName1": { "x": 168, "y": 323 }, "emgRel1": { "x": 458, "y": 323 }, "emgAddr1": { "x": 168, "y": 305 }, "emgTel1": { "x": 168, "y": 287 } },
      "p10": { "date": { "x": 420, "y": 756 }, "address": { "x": 205, "y": 376 }, "signature": { "x": 195, "y": 311 }, "parentRel": { "x": 210, "y": 286 }, "childName": { "x": 205, "y": 222 } },
      "p11": { "date": { "x": 110, "y": 216 }, "address": { "x": 280, "y": 134 }, "signature": { "x": 280, "y": 82 }, "childName": { "x": 280, "y": 64 } }
    }
  };

  let currentCoords = JSON.parse(JSON.stringify(DEFAULT_COORDS));
  let currentPassword = "016838";

  const loadScript = (src) => new Promise(res => {
    const s = document.createElement('script'); s.src = src; s.onload = res; document.head.appendChild(s);
  });

  let cache = { pTamaki: null, pMeiwa: null, sig: null, sigT: null, font: null };

  const loadCaches = async (isSimulator = false) => {
    const apiBase = (m => m ? '/k/guest/' + m[1] : '/k')(location.pathname.match(/^\/k\/guest\/(\d+)\//));
    const headers = { "X-Requested-With": "XMLHttpRequest" };

    const mResp = await kintone.api(apiBase + '/v1/record.json', 'GET', { app: MASTER_APP_ID, id: MASTER_RECORD_ID });
    const savedStr = mResp.record[FIELDS.coordsData]?.value;
    if (savedStr) {
      try { 
        const loadedData = JSON.parse(savedStr); 
        if (loadedData.tamaki) { currentCoords = loadedData; } 
        else {
          currentCoords = loadedData.coords || JSON.parse(JSON.stringify(DEFAULT_COORDS));
          currentPassword = loadedData.password || "016838";
        }
      } catch(e) { currentCoords = JSON.parse(JSON.stringify(DEFAULT_COORDS)); }
    }

    if (cache.font) return; 

    const record = kintone.app.record.get().record;
    if (!isSimulator && !record[FIELDS.signature]?.value?.length) {
      throw new Error('エラー：このレコードの「利用者サイン」に画像がありません。');
    }
    
    if (typeof PDFLib === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
    if (typeof fontkit === 'undefined') await loadScript('https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js');

    const fT = mResp.record[FIELDS.masterPdfTamaki]?.value[0];
    const fM = mResp.record[FIELDS.masterPdfMeiwa]?.value[0];
    if (!fT || !fM) throw new Error('原本PDFが見つかりません。');

    const sigF = record[FIELDS.signature]?.value?.[0];
    const fetchPromises = [
      fetch(apiBase + '/v1/file.json?fileKey=' + fT.fileKey, { headers }).then(r => r.arrayBuffer()),
      fetch(apiBase + '/v1/file.json?fileKey=' + fM.fileKey, { headers }).then(r => r.arrayBuffer()),
      fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf').then(r => r.arrayBuffer())
    ];

    if (sigF) {
      cache.sigT = sigF.contentType.includes('png') ? 'png' : 'jpg';
      fetchPromises.push(fetch(apiBase + '/v1/file.json?fileKey=' + sigF.fileKey, { headers }).then(r => r.arrayBuffer()));
    }

    const results = await Promise.all(fetchPromises);
    cache.pTamaki = results[0];
    cache.pMeiwa = results[1];
    cache.font = results[2];
    if (sigF) cache.sig = results[3];
  };

  const drawAllPages = (pages, type, customFont, sigImg, sigScale, getValue, dateTextJP) => {
    const c = currentCoords[type];
    const drawT = (pageIdx, val, posObj, s = 10) => {
      pages[pageIdx].drawText(val, { x: posObj.x, y: posObj.y, size: s, font: customFont });
    };

    drawT(0, getValue(FIELDS.parentText), c.p1.parentText, 11);
    drawT(0, getValue(FIELDS.childName), c.p1.childName, 11);
    drawT(0, dateTextJP, c.p1.date, 11);
    
    drawT(3, dateTextJP, c.p4.date, 11);
    drawT(3, getValue(FIELDS.address), c.p4.address);
    if (sigImg) pages[3].drawImage(sigImg, { x: c.p4.signature.x, y: c.p4.signature.y, width: sigScale.width, height: sigScale.height });
    drawT(3, getValue(FIELDS.childName), c.p4.childName, 11);
    
    drawT(7, getValue(FIELDS.kakaritsuke), c.p8.kakaritsuke);
    drawT(7, getValue(FIELDS.shinryoka), c.p8.shinryoka);
    drawT(7, getValue(FIELDS.shuji), c.p8.shuji);
    drawT(7, getValue(FIELDS.hospAddress), c.p8.hospAddress);
    drawT(7, getValue(FIELDS.hospTel), c.p8.hospTel);
    drawT(7, getValue(FIELDS.emgName1), c.p8.emgName1);
    drawT(7, getValue(FIELDS.emgRel1), c.p8.emgRel1);
    drawT(7, getValue(FIELDS.emgAddr1), c.p8.emgAddr1);
    drawT(7, getValue(FIELDS.emgTel1), c.p8.emgTel1);
    
    drawT(9, dateTextJP, c.p10.date, 11);
    drawT(9, getValue(FIELDS.address), c.p10.address);
    if (sigImg) pages[9].drawImage(sigImg, { x: c.p10.signature.x, y: c.p10.signature.y, width: sigScale.width, height: sigScale.height });
    drawT(9, getValue(FIELDS.parentRel), c.p10.parentRel, 11);
    drawT(9, getValue(FIELDS.childName), c.p10.childName, 11);
    
    drawT(10, dateTextJP, c.p11.date, 11);
    drawT(10, getValue(FIELDS.address), c.p11.address);
    if (sigImg) pages[10].drawImage(sigImg, { x: c.p11.signature.x, y: c.p11.signature.y, width: sigScale.width, height: sigScale.height });
    drawT(10, getValue(FIELDS.childName), c.p11.childName, 11);
  };

  const createPdfBytes = async (type) => {
    const pdfBuf = type === 'tamaki' ? cache.pTamaki : cache.pMeiwa;
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBuf);
    pdfDoc.registerFontkit(window.fontkit);
    const customFont = await pdfDoc.embedFont(cache.font);
    
    let sigImg = null;
    let sigScale = null;
    if (cache.sig) {
      sigImg = cache.sigT === 'png' ? await pdfDoc.embedPng(cache.sig) : await pdfDoc.embedJpg(cache.sig);
      sigScale = sigImg.scale(0.12);
    }

    const pages = pdfDoc.getPages();
    const record = kintone.app.record.get().record;
    const getValue = (f) => record[f] ? (record[f].value || '') : '';
    const dVal = getValue(FIELDS.date);
    const d = dVal ? new Date(dVal) : new Date();
    const dateTextJP = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

    drawAllPages(pages, type, customFont, sigImg, sigScale, getValue, dateTextJP);
    return await pdfDoc.save();
  };

  const openSimulator = async () => {
    const inputPwd = prompt('パスワードを入力してください');
    if (inputPwd === null) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:10000; display:flex;';
    const loading = document.createElement('div');
    loading.innerText = 'データを読み込み中...';
    loading.style.cssText = 'color:white; font-size:24px; margin:auto;';
    overlay.appendChild(loading);
    document.body.appendChild(overlay);

    try {
      await loadCaches(true); 
    } catch(e) {
      alert(e.message);
      overlay.remove();
      return;
    }

    if (inputPwd !== currentPassword) {
      alert('パスワードが違います。');
      overlay.remove();
      return;
    }
    
    loading.remove();
    let mode = 'tamaki';

    // ===== iPad対応のため、プレビューエリアの定義を変更 =====
    const previewArea = document.createElement('div');
    // overflow-y:auto と -webkit-overflow-scrolling:touch を追加し、背景色を指定
    previewArea.style.cssText = 'flex:1; height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; background:#525659;';
    
    // iframeの代わりに、objectタグを流し込むためのコンテナを用意
    const viewerContainer = document.createElement('div');
    viewerContainer.id = 'pdf-viewer-container';
    viewerContainer.style.cssText = 'width:100%; height:100%; min-height:100vh;';
    previewArea.appendChild(viewerContainer);
    // ========================================================

    const panel = document.createElement('div');
    panel.style.cssText = 'width:420px; background:#f4f4f4; padding:15px; overflow-y:auto; font-size:12px; display:flex; flex-direction:column;';
    
    const header = document.createElement('div');
    header.innerHTML = `<h3 style="margin:0 0 10px 0;">座標シミュレーター</h3>
      <div style="margin-bottom:10px;">
        <label><input type="radio" name="sim_mode" value="tamaki" checked> 玉城原本</label>
        <label style="margin-left:10px;"><input type="radio" name="sim_mode" value="meiwa"> 明和原本</label>
      </div>
      <p style="font-size:11px; color:#555;">数値を直接入力するか、ボタンで微調整できます。</p>
      <hr>`;

    const controls = document.createElement('div');
    controls.style.cssText = 'flex:1; overflow-y:auto;';

    let updateTimer = null;
    const updatePreview = async () => {
      try {
        const bytes = await createPdfBytes(mode);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        // ===== iPad対応: objectタグを使用して#view=FitVパラメータを付与 =====
        const container = document.getElementById('pdf-viewer-container');
        container.innerHTML = `
          <object data="${url}#view=FitV&pagemode=thumbs" type="application/pdf" width="100%" height="100%">
            <iframe src="${url}#view=FitV" style="width:100%; height:100%; border:none;">
              PDFを表示できません。
            </iframe>
          </object>
        `;
        // ===================================================================
      } catch(e) {}
    };

    const scheduleUpdate = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => { updatePreview(); }, 200); 
    };

    // 元のボタン配置レイアウトを完全に維持
    const buildControls = () => {
      controls.innerHTML = '';
      const c = currentCoords[mode];
      const pageNames = { p1: '1ページ', p4: '4ページ', p8: '8ページ', p10: '10ページ', p11: '11ページ' };
      
      Object.keys(c).forEach(pKey => {
        const pDiv = document.createElement('div');
        pDiv.style.cssText = 'margin-bottom:15px; background:#fff; padding:10px; border-radius:4px; border:1px solid #ddd;';
        pDiv.innerHTML = `<strong style="color:#2980b9;">${pageNames[pKey]}</strong>`;
        
        Object.keys(c[pKey]).forEach(fKey => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-top:5px; padding-bottom:5px; border-bottom:1px dashed #eee;';
          const label = document.createElement('div');
          label.innerText = fieldLabels[fKey] || fKey;
          label.style.width = '70px';

          const inputGroup = document.createElement('div');
          inputGroup.style.cssText = 'display:flex; align-items:center;';
          const inputX = document.createElement('input');
          inputX.type = 'number'; inputX.value = c[pKey][fKey].x; inputX.style.cssText = 'width:40px; margin:0 5px 0 2px;';
          const inputY = document.createElement('input');
          inputY.type = 'number'; inputY.value = c[pKey][fKey].y; inputY.style.cssText = 'width:40px; margin:0 5px 0 2px;';

          const onInputChange = () => {
            c[pKey][fKey].x = Number(inputX.value); c[pKey][fKey].y = Number(inputY.value);
            scheduleUpdate();
          };
          inputX.onchange = onInputChange; inputY.onchange = onInputChange;
          inputGroup.innerHTML = `<span>X:</span>`;
          inputGroup.appendChild(inputX);
          inputGroup.insertAdjacentHTML('beforeend', `<span>Y:</span>`);
          inputGroup.appendChild(inputY);

          const btnGroup = document.createElement('div');
          const makeBtn = (txt, dx, dy) => {
            const btn = document.createElement('button');
            btn.innerText = txt;
            btn.style.cssText = 'width:24px; height:22px; padding:0; margin:1px; cursor:pointer; font-size:11px; background:#ecf0f1; border:1px solid #bdc3c7; border-radius:3px;';
            btn.onclick = () => {
              c[pKey][fKey].x += dx; c[pKey][fKey].y += dy;
              inputX.value = c[pKey][fKey].x; inputY.value = c[pKey][fKey].y;
              scheduleUpdate();
            };
            return btn;
          };
          btnGroup.appendChild(makeBtn('上', 0, 1));
          btnGroup.appendChild(makeBtn('下', 0, -1));
          btnGroup.appendChild(makeBtn('左', -1, 0));
          btnGroup.appendChild(makeBtn('右', 1, 0));

          row.appendChild(label); row.appendChild(inputGroup); row.appendChild(btnGroup);
          pDiv.appendChild(row);
        });
        controls.appendChild(pDiv);
      });
    };

    header.querySelectorAll('input[name="sim_mode"]').forEach(r => {
      r.onchange = (e) => { mode = e.target.value; buildControls(); updatePreview(); };
    });

    const passwordDiv = document.createElement('div');
    passwordDiv.style.cssText = 'margin-top:10px; padding-top:10px; border-top:1px solid #ccc; font-size:11px; text-align:right; color:#555;';
    passwordDiv.innerHTML = `パスワード変更: <input type="text" id="sim_pwd_input" value="${currentPassword}" style="width:80px; padding:2px; margin-left:5px;">`;

    const saveBtn = document.createElement('button');
    saveBtn.innerText = '設定をkintoneに保存して終了';
    saveBtn.style.cssText = 'width:100%; padding:10px; margin-top:10px; background:#27ae60; color:#fff; border:none; cursor:pointer; font-weight:bold;';
    saveBtn.onclick = async () => {
      const newPwd = document.getElementById('sim_pwd_input').value;
      if(!newPwd) return alert('パスワードを空にはできません。');
      saveBtn.innerText = '保存中...'; saveBtn.disabled = true;
      try {
        const apiBase = (m => m ? '/k/guest/' + m[1] : '/k')(location.pathname.match(/^\/k\/guest\/(\d+)\//));
        await kintone.api(apiBase + '/v1/record.json', 'PUT', {
          app: MASTER_APP_ID, id: MASTER_RECORD_ID,
          record: { [FIELDS.coordsData]: { value: JSON.stringify({ password: newPwd, coords: currentCoords }) } }
        });
        currentPassword = newPwd; alert('設定を保存しました！'); overlay.remove();
      } catch (e) { alert('保存失敗: ' + e.message); saveBtn.innerText = '設定をkintoneに保存して終了'; saveBtn.disabled = false; }
    };

    const resetBtn = document.createElement('button');
    resetBtn.innerText = '初期値に戻して保存';
    resetBtn.style.cssText = 'width:100%; padding:10px; margin-top:10px; background:#e74c3c; color:#fff; border:none; cursor:pointer; font-weight:bold;';
    resetBtn.onclick = async () => {
      if(confirm('初期状態に戻しますか？')) {
        currentCoords = JSON.parse(JSON.stringify(DEFAULT_COORDS)); currentPassword = "016838";
        try {
          const apiBase = (m => m ? '/k/guest/' + m[1] : '/k')(location.pathname.match(/^\/k\/guest\/(\d+)\//));
          await kintone.api(apiBase + '/v1/record.json', 'PUT', {
            app: MASTER_APP_ID, id: MASTER_RECORD_ID,
            record: { [FIELDS.coordsData]: { value: JSON.stringify({ password: currentPassword, coords: currentCoords }) } }
          });
          document.getElementById('sim_pwd_input').value = currentPassword; buildControls(); scheduleUpdate(); alert('リセットしました。');
        } catch(e) { alert('リセット失敗。'); }
      }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = '保存せずに閉じる';
    cancelBtn.style.cssText = 'width:100%; padding:10px; margin-top:10px; background:#95a5a6; color:#fff; border:none; cursor:pointer; font-weight:bold;';
    cancelBtn.onclick = () => overlay.remove();

    panel.appendChild(header); panel.appendChild(controls); panel.appendChild(passwordDiv); panel.appendChild(saveBtn); panel.appendChild(resetBtn); panel.appendChild(cancelBtn);
    overlay.appendChild(previewArea); overlay.appendChild(panel);
    buildControls(); updatePreview(); 
  };

  const runProcess = async (type) => {
    try {
      await loadCaches(false); 
      const bytes = await createPdfBytes(type);
      const record = kintone.app.record.get().record;
      const apiBase = (m => m ? '/k/guest/' + m[1] : '/k')(location.pathname.match(/^\/k\/guest\/(\d+)\//));
      const dVal = record[FIELDS.date]?.value || '';
      const d = dVal ? new Date(dVal) : new Date();
      const dateTextRaw = `${d.getFullYear()}${('0'+(d.getMonth()+1)).slice(-2)}${('0'+d.getDate()).slice(-2)}`;
      const label = type === 'tamaki' ? '玉城' : '明和';
      const fileName = `${dateTextRaw}${record[FIELDS.childName]?.value || '契約書'}_${label}.pdf`;
      const fd = new FormData();
      fd.append('file', new Blob([bytes], { type: 'application/pdf' }), fileName);
      fd.append('__REQUEST_TOKEN__', kintone.getRequestToken());
      const up = await fetch(apiBase + '/v1/file.json', { method: 'POST', headers: { "X-Requested-With": "XMLHttpRequest" }, body: fd }).then(r => r.json());
      const currentFiles = record[FIELDS.savePdf]?.value ? record[FIELDS.savePdf].value.map(f => ({ fileKey: f.fileKey })) : [];
      await kintone.api(apiBase + '/v1/record.json', 'PUT', { app: kintone.app.getId(), id: kintone.app.record.getId(), record: { [FIELDS.savePdf]: { value: currentFiles.concat([{ fileKey: up.fileKey }]) } } });
      alert(`契約書（${label}）を保存しました`); location.reload();
    } catch (e) { alert(e.message); }
  };

  kintone.events.on(['app.record.detail.show'], (ev) => {
    const mount = kintone.app.record.getHeaderMenuSpaceElement();
    if (!mount) return ev;
    const createBtn = (id, text, color, onclick) => {
      if (document.getElementById(id)) return;
      const btn = document.createElement('button');
      btn.id = id; btn.innerText = text;
      btn.style.cssText = `margin:10px 5px; padding:12px; background:${color}; color:#fff; border-radius:6px; cursor:pointer; font-weight:bold; border:none;`;
      btn.onclick = onclick;
      mount.appendChild(btn);
    };
    createBtn('tamaki_pdf_btn', '契約書保存（玉城）', '#16a085', () => runProcess('tamaki'));
    createBtn('meiwa_pdf_btn',  '契約書保存（明和）', '#16a085', () => runProcess('meiwa'));
    createBtn('coord_tool_btn', '座標設定', '#000000', openSimulator);
    return ev;
  });

})();