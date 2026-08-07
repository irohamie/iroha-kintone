(() => {
  'use strict';

  // ==========================================
  // 共通設定・ユーティリティ
  // ==========================================
  
  // 印刷プレビュー対象のフィールドコード（追加要望を反映）
  const PRINT_TARGET_FIELDS = ['前期計画', '前期評価', '後期計画', '後期評価']; 
  const WRAPPER_ID = 'custom_header_wrapper_v4'; // 全ボタンをまとめる大枠

  // ゲストスペースを考慮したAPIのベースURL取得
  const getApiBase = () => {
    const m = location.pathname.match(/^\/k\/guest\/(\d+)\//);
    return m ? `/k/guest/${m[1]}` : '/k';
  };

  // ==========================================
  // 機能0: サイン前必須項目バリデーション
  // ==========================================

  // フィールド値が未入力かどうかを判定（文字列1行／ドロップダウン／チェックボックス対応）
  const isEmptyFieldValue = (field) => {
    if (!field) return true;
    const v = field.value;
    if (Array.isArray(v)) return v.length === 0;
    return v === null || v === undefined || v === '';
  };

  // requiredFields（フィールドコード配列）を検証し、未入力のフィールドコード配列を返す
  const getMissingFields = (rec, requiredFields) => {
    return (requiredFields || []).filter(code => isEmptyFieldValue(rec[code]));
  };

  // ==========================================
  // 機能1: サイン保存（合成）処理
  // ==========================================
  
  // サイン用のUI制御（ローダーおよび複数時の選択画面）
  const toggleUI = (type, show, data, callback) => {
    let el = document.getElementById('pdf_ui_v32');
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'pdf_ui_v32';
        el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;padding:20px;';
        document.body.appendChild(el);
      }
      if (type === 'loading') {
        el.innerHTML = '<div style="border:5px solid #f3f3f3;border-top:5px solid #3498db;border-radius:50%;width:50px;height:50px;animation:spin 1s linear infinite;"></div>' +
                       '<p style="margin-top:20px;font-weight:bold;color:#333;">' + data + '</p>' +
                       '<style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>';
      } else if (type === 'select') {
        let html = '<div style="background:#fff;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:400px;text-align:center;">' +
                   '<h3 style="margin-top:0;color:#333;">対象のPDFを選択</h3>' +
                   '<p style="font-size:13px;color:#666;">条件に合うファイルが複数見つかりました</p>' +
                   '<select id="pdf_select" style="width:100%;padding:12px;margin:15px 0;border-radius:8px;border:1px solid #ccc;font-size:16px;background:#fff;color:#333;-webkit-appearance:menulist;">';
        data.forEach(f => { html += '<option value="' + f.fileKey + '" data-name="' + f.name + '">' + f.name + '</option>'; });
        html += '</select>' +
                '<button id="pdf_exec" style="width:100%;padding:15px;background:#3498db;color:#fff;border:none;border-radius:8px;font-weight:bold;margin-bottom:10px;font-size:16px;-webkit-appearance:none;cursor:pointer;">サイン保存を実行</button>' +
                '<button id="pdf_cancel" style="width:100%;padding:10px;background:#eee;color:#666;border:none;border-radius:8px;font-size:14px;-webkit-appearance:none;cursor:pointer;">キャンセル</button></div>';
        el.innerHTML = html;
        document.getElementById('pdf_exec').onclick = () => {
          const sel = document.getElementById('pdf_select');
          callback(sel.value, sel.options[sel.selectedIndex].getAttribute('data-name'));
        };
        document.getElementById('pdf_cancel').onclick = () => toggleUI(null, false);
      }
    } else if (el) { el.remove(); }
  };

  const runStamp = async (fileKey, originalName, imgField, destField) => {
    const recordData = kintone.app.record.get();
    const rec = recordData.record;
    const imgs = rec[imgField].value || [];
    if (!imgs.length) return alert("署名画像（" + imgField + "）がありません。");

    toggleUI('loading', true, "保存処理中...");
    try {
      const api = getApiBase();
      const head = {"X-Requested-With": "XMLHttpRequest"};

      const pB = await fetch(api + "/v1/file.json?fileKey=" + fileKey, {headers: head}).then(r => r.arrayBuffer());
      const iB = await fetch(api + "/v1/file.json?fileKey=" + imgs[0].fileKey, {headers: head}).then(r => r.arrayBuffer());

      const doc = await PDFLib.PDFDocument.load(pB);
      const img = imgs[0].contentType.includes("png") ? await doc.embedPng(iB) : await doc.embedJpg(iB);
      
      // 座標指定
      doc.getPages()[0].drawImage(img, { 
        x: 85.0, y: 14.2, 
        width: img.scale(0.1).width, height: img.scale(0.1).height 
      });
      
      const bytes = await doc.save();
      let newName = originalName.replace(/\(計画\)/g, '(サイン済)').replace(/\(表\)/g, '(サイン済)');
      if (newName === originalName) newName = originalName.replace(/\.pdf$/i, '_サイン済.pdf');

      const fd = new FormData();
      fd.append('file', new Blob([bytes], {type:'application/pdf'}), newName);
      fd.append('__REQUEST_TOKEN__', kintone.getRequestToken());
      const up = await fetch(api + "/v1/file.json", { method: 'POST', headers: head, body: fd }).then(r => r.json());

      const exist = (rec[destField] && rec[destField].value || []).map(f => ({fileKey: f.fileKey}));
      await kintone.api(api + '/v1/record.json', 'PUT', {
        app: kintone.app.getId() || kintone.mobile.app.getId(),
        id: kintone.app.record.getId() || kintone.mobile.app.record.getId(),
        record: { [destField]: { value: exist.concat([{fileKey: up.fileKey}]) } }
      });

      location.reload();
    } catch (e) { 
      alert("エラー: " + e.message); 
      toggleUI(null, false); 
    }
  };

  // ==========================================
  // 機能2: 分割印刷プレビュー処理（ポップアップ版）
  // ==========================================
  
  const showPrintPopup = (filesPayload) => {
    let el = document.getElementById('print_popup_v1');
    if (!el) {
      el = document.createElement('div');
      el.id = 'print_popup_v1';
      // kintoneの画面上にオーバーレイ表示
      el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.95);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:20px;';
      document.body.appendChild(el);
    }

    // セレクトボックスの選択肢を生成
    let selectOptions = '<option value="">-- 印刷するPDFを選択 --</option>';
    filesPayload.forEach(group => {
      selectOptions += `<optgroup label="${group.label}">`;
      group.items.forEach(f => {
        selectOptions += `<option value="${f.fileKey}">${f.name}</option>`;
      });
      selectOptions += `</optgroup>`;
    });

    el.innerHTML = `
      <div style="background:#fff;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:420px;text-align:left;">
        <h3 style="margin-top:0;color:#333;">印刷プレビュー</h3>
        <p style="font-size:13px;color:#666;margin-bottom:15px;">印刷用にA4サイズでプレビューを生成します。</p>
        <select id="print_file_select" style="width:100%;padding:12px;font-size:16px;border-radius:8px;border:1px solid #ccc;margin-bottom:20px;background:#fff;color:#333;">
          ${selectOptions}
        </select>
        
        <div id="print_loading" style="display:none; text-align:center; padding:15px 0;">
          <div style="border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;width:35px;height:35px;animation:spin 1s linear infinite;margin:0 auto 10px;"></div>
          <p style="font-size:13px;color:#666;margin:0;">処理しています...<br><span style="font-size:11px;">(数秒かかる場合があります)</span></p>
        </div>
        
        <div id="print_btn_area" style="display:flex; gap:10px;">
          <button id="print_exec" style="flex:1;padding:14px;background:#3498db;color:#fff;border:none;border-radius:8px;font-weight:bold;font-size:15px;cursor:pointer;">プレビューを表示</button>
          <button id="print_cancel" style="flex:1;padding:14px;background:#eee;color:#666;border:none;border-radius:8px;font-size:15px;cursor:pointer;">キャンセル</button>
        </div>
      </div>
      <style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
    `;

    document.getElementById('print_cancel').onclick = () => el.remove();
    
    // ★ iOSポップアップブロック対策対応済み ★
    document.getElementById('print_exec').onclick = async () => {
      const fileKey = document.getElementById('print_file_select').value;
      if (!fileKey) return alert('ファイルを選択してください');

      // 非同期処理に入る前に、ユーザーのアクション直後に新しいタブを開く
      const previewWindow = window.open('', '_blank');
      if (!previewWindow) {
        alert('ブラウザのポップアップブロックによりタブが開けませんでした。設定からポップアップを許可してください。');
        return;
      }
      // タブが真っ白だと不安になるため、ロード中のメッセージを表示しておく
      previewWindow.document.write('<div style="padding:20px;font-family:sans-serif;color:#333;">PDFを生成しています。しばらくお待ちください...</div>');

      document.getElementById('print_btn_area').style.display = 'none';
      document.getElementById('print_file_select').disabled = true;
      document.getElementById('print_loading').style.display = 'block';

      try {
        const apiBase = getApiBase();
        const resp = await fetch(apiBase + '/v1/file.json?fileKey=' + fileKey, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!resp.ok) throw new Error('ファイルの取得に失敗しました');
        const arrayBuffer = await resp.arrayBuffer();

        const { PDFDocument } = PDFLib;
        const srcDoc = await PDFDocument.load(arrayBuffer);
        const outDoc = await PDFDocument.create();

        for (let i = 0; i < srcDoc.getPageCount(); i++) {
          const [p1, p2] = await outDoc.copyPages(srcDoc, [i, i]);
          const { width, height } = p1.getSize();
          const mid = height / 2;
          p1.setCropBox(0, mid, width, mid);
          outDoc.addPage(p1);
          p2.setCropBox(0, 0, width, mid);
          outDoc.addPage(p2);
        }

        const pdfBytes = await outDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        // 先に開いておいたタブのURLに、生成したPDFのBlob URLをセットする
        previewWindow.location.href = url;
        el.remove(); // 元画面のポップアップは閉じる

      } catch (e) {
        previewWindow.close(); // エラーが起きたら開いたタブを閉じる
        alert('エラーが発生しました: ' + e.message);
        el.remove();
      }
    };
  };

  const onPrintClick = (record) => {
    // 印刷対象の全フィールドからPDFを抽出してグループ化
    const filesPayload = PRINT_TARGET_FIELDS.map(code => {
      const field = record[code];
      const items = (field && field.value) ? field.value.filter(f => f.name.toLowerCase().endsWith('.pdf')) : [];
      return { label: code, items: items };
    }).filter(group => group.items.length > 0);
    
    if (filesPayload.length === 0) {
      alert(`対象のフィールド（${PRINT_TARGET_FIELDS.join(', ')}）にPDFファイルが見つかりません。`);
      return;
    }

    // ポップアップを起動
    showPrintPopup(filesPayload);
  };

  // ==========================================
  // 機能3: 利用先に応じた児発管ラジオボタン自動設定
  // ==========================================
  
  const AUTO_RADIO_SRC_FIELD = '利用先';
  const AUTO_RADIO_DEST_FIELD = '児発管';
  // 利用先の文字列 → 選択肢の並び順インデックス（0始まり）の対応表
  const AUTO_RADIO_MAP = { '玉城': 0, '明和': 1 };

  // 児発管フィールドの選択肢を並び順（index）でソートしたラベル配列（キャッシュ）
  let _radioOptionsCache = null;

  const fetchSortedRadioOptions = async (fieldCode) => {
    if (_radioOptionsCache) return _radioOptionsCache;

    const appId = kintone.app.getId() || kintone.mobile.app.getId();
    const resp = await kintone.api(getApiBase() + '/v1/app/form/fields.json', 'GET', { app: appId });
    const options = resp.properties[fieldCode] && resp.properties[fieldCode].options;
    if (!options) return null;

    _radioOptionsCache = Object.keys(options)
      .sort((a, b) => Number(options[a].index) - Number(options[b].index))
      .map(key => options[key].label);

    return _radioOptionsCache;
  };

  const applyAutoRadioSet = async (record) => {
    const destField = record[AUTO_RADIO_DEST_FIELD];
    if (!destField) return;

    const srcField = record[AUTO_RADIO_SRC_FIELD];
    const srcValue = srcField && srcField.value;
    if (!(srcValue in AUTO_RADIO_MAP)) return; // 玉城／明和以外はスルー（既存値も変更しない）

    try {
      const sortedOptions = await fetchSortedRadioOptions(AUTO_RADIO_DEST_FIELD);
      const targetIndex = AUTO_RADIO_MAP[srcValue];
      if (!sortedOptions || !sortedOptions[targetIndex]) return;

      const correctValue = sortedOptions[targetIndex];
      if (destField.value !== correctValue) {
        record[AUTO_RADIO_DEST_FIELD].value = correctValue; // 未入力・矛盾のどちらの場合も強制上書き
      }
    } catch (e) {
      console.error('児発管の自動設定に失敗しました:', e);
    }
  };

  // ==========================================
  // イベント登録・ボタン群の描画処理
  // ==========================================
  
  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], (ev) => {
    const mount = kintone.app.record.getHeaderMenuSpaceElement() || kintone.mobile.app.getHeaderSpaceElement();
    if (!mount) return;

    // 既に描画済みの場合はスキップ
    if (document.getElementById(WRAPPER_ID)) return;

    // pdf-libライブラリの読み込み
    if (typeof PDFLib === 'undefined' && !document.getElementById('pdf_lib_script')) {
      const s = document.createElement('script'); 
      s.id = 'pdf_lib_script';
      s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      document.head.appendChild(s);
    }

    // --- ボタンをまとめる大枠（ラッパー）を作成 ---
    const myWrapper = document.createElement('div');
    myWrapper.id = WRAPPER_ID;
    myWrapper.style.display = 'inline-block'; // Kintone標準の並び方に合わせる

    // 1. 【一番左】印刷プレビューボタン
    const printBtn = document.createElement('button');
    printBtn.innerText = '印刷';
    printBtn.className = 'kintoneplugin-button-normal';
    printBtn.style.cssText = 'margin:10px 5px; padding:4px 12px !important; min-height:42px; font-weight:700; border-radius:4px; vertical-align: top; cursor:pointer;';
    printBtn.onclick = () => onPrintClick(ev.record);
    myWrapper.appendChild(printBtn);

    // 2. 【印刷ボタンの右】サインボタン群
    const buttons = [
      {
        text: '前期立案サイン', keyword: '立案', srcField: '前期計画', imgField: '前期立案署名', destField: '前期サイン済', color: '#3498db',
        requiredFields: ['前期本人希望', '前期保護者希望', '前期専門アセス', '前期専門目標']
      },
      {
        text: '前期評価サイン', keyword: '評価', srcField: '前期評価', imgField: '前期評価署名', destField: '前期サイン済', color: '#e67e22',
        requiredFields: ['前期本人希望', '前期保護者希望', '前期専門アセス', '前期専門目標', '前期専門モニタ']
      },
      {
        text: '後期立案サイン', keyword: '立案', srcField: '後期計画', imgField: '後期立案署名', destField: '後期サイン済', color: '#3498db',
        requiredFields: ['後期本人希望', '後期保護者希望', '後期専門アセス', '後期専門目標']
      },
      {
        text: '後期評価サイン', keyword: '評価', srcField: '後期評価', imgField: '後期評価署名', destField: '後期サイン済', color: '#e67e22',
        requiredFields: ['後期本人希望', '後期保護者希望', '後期専門アセス', '後期専門目標', '後期専門モニタ']
      }
    ];

    buttons.forEach(btnConfig => {
      const b = document.createElement('button');
      b.innerText = btnConfig.text;
      b.style.cssText = 'margin:10px 5px; padding:12px 18px; background-color: ' + btnConfig.color + ' !important; color: #ffffff !important; border: none !important; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 14px; -webkit-appearance: none; -webkit-tap-highlight-color: transparent; outline: none; vertical-align: top;';
      
      b.onclick = () => {
        const rec = kintone.app.record.get().record;

        // --- サイン前の必須項目チェック ---
        const missing = getMissingFields(rec, btnConfig.requiredFields);
        if (missing.length > 0) {
          alert("以下の項目が入力されていません。\n" + missing.join('、'));
          return;
        }

        const targets = (rec[btnConfig.srcField].value || []).filter(f => 
          f.name.toLowerCase().endsWith('.pdf') && f.name.includes(btnConfig.keyword)
        );

        if (targets.length === 0) {
          alert("「" + btnConfig.srcField + "」に「" + btnConfig.keyword + "」を含むPDFが見つかりません。");
        } else if (targets.length === 1) {
          runStamp(targets[0].fileKey, targets[0].name, btnConfig.imgField, btnConfig.destField);
        } else {
          toggleUI('select', true, targets, (fk, nm) => runStamp(fk, nm, btnConfig.imgField, btnConfig.destField));
        }
      };
      myWrapper.appendChild(b);
    });

    // カスタムボタン群をヘッダーの「一番最初」に挿入
    if (mount.firstChild) {
      mount.insertBefore(myWrapper, mount.firstChild);
    } else {
      mount.appendChild(myWrapper);
    }

    // 3. 【強制改行】プラグインボタンを確実に2行目へ押し出すためのブロック
    const lineBreak = document.createElement('div');
    lineBreak.style.cssText = 'display: block; width: 100%; height: 0; clear: both;';
    
    // 自作ラッパーの直後に改行要素を挿入
    if (myWrapper.nextSibling) {
      mount.insertBefore(lineBreak, myWrapper.nextSibling);
    } else {
      mount.appendChild(lineBreak);
    }

    return ev;
  });

  // --- 新規作成／編集画面表示時に一度だけ自動設定を実行 ---
  kintone.events.on(
    ['app.record.create.show', 'app.record.edit.show', 'mobile.app.record.create.show', 'mobile.app.record.edit.show'],
    async (event) => {
      await applyAutoRadioSet(event.record);
      return event;
    }
  );

  // --- 「利用先」変更時にも自動設定を実行 ---
  kintone.events.on(
    [
      'app.record.create.change.' + AUTO_RADIO_SRC_FIELD,
      'app.record.edit.change.' + AUTO_RADIO_SRC_FIELD,
      'mobile.app.record.create.change.' + AUTO_RADIO_SRC_FIELD,
      'mobile.app.record.edit.change.' + AUTO_RADIO_SRC_FIELD
    ],
    async (event) => {
      await applyAutoRadioSet(event.record);
      return event;
    }
  );

  // --- ルックアップ元フィールド「氏名」変更時にも自動設定を実行 ---
  const AUTO_RADIO_LOOKUP_FIELD = '氏名';
  kintone.events.on(
    [
      'app.record.create.change.' + AUTO_RADIO_LOOKUP_FIELD,
      'app.record.edit.change.' + AUTO_RADIO_LOOKUP_FIELD,
      'mobile.app.record.create.change.' + AUTO_RADIO_LOOKUP_FIELD,
      'mobile.app.record.edit.change.' + AUTO_RADIO_LOOKUP_FIELD
    ],
    async (event) => {
      await applyAutoRadioSet(event.record);
      return event;
    }
  );

  // --- 保存ボタン押下時（submit）にも保険として自動設定を実行 ---
  kintone.events.on(
    ['app.record.create.submit', 'app.record.edit.submit', 'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'],
    async (event) => {
      await applyAutoRadioSet(event.record);
      return event;
    }
  );

})();
