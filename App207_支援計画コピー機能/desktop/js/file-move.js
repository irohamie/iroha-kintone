(function() {
  'use strict';

  // 移動元と移動先のフィールドコードのペア
  const FIELD_PAIRS = [
    { from: '前期案', to: '前期評価案' },
    { from: '前期計画', to: '前期評価' },
    { from: '前期サイン済', to: '前期評価サイン済' },
    { from: '後期案', to: '後期評価案' },
    { from: '後期計画', to: '後期評価' },
    { from: '後期サイン済', to: '後期評価サイン済' }
  ];

  // 1. ファイルをダウンロードする関数
  const downloadFile = async (fileKey) => {
    const url = kintone.api.url('/k/v1/file', true) + '?fileKey=' + fileKey;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    return await response.blob();
  };

  // 2. ファイルをアップロードする関数
  const uploadFile = async (blob, fileName) => {
    const formData = new FormData();
    formData.append('__REQUEST_TOKEN__', kintone.getRequestToken());
    formData.append('file', blob, fileName);

    const url = kintone.api.url('/k/v1/file', true);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: formData
    });
    const json = await response.json();
    return json.fileKey;
  };

  // 3. 1レコード分のファイル移動処理を行う関数
  const processRecord = async (recordId, record) => {
    let needsUpdate = false;
    const recordUpdateData = {};

    for (const pair of FIELD_PAIRS) {
      const fromField = record[pair.from];
      const toField = record[pair.to];

      // 移動元フィールドが存在し、ファイルが入っているか確認
      if (!fromField || !fromField.value || fromField.value.length === 0) continue;

      // 「評価」が含まれるファイルと、含まれないファイルに分ける
      const filesToMove = fromField.value.filter(file => file.name.includes('評価'));
      const filesToKeep = fromField.value.filter(file => !file.name.includes('評価'));

      if (filesToMove.length > 0) {
        needsUpdate = true;
        
        // 移動先の既存ファイルと、移動元の残すファイルをセット
        const newToFileKeys = toField && toField.value ? toField.value.map(file => ({ fileKey: file.fileKey })) : [];
        const newFromFileKeys = filesToKeep.map(file => ({ fileKey: file.fileKey }));

        // 対象ファイルをダウンロード＆アップロードして移動先に追加
        for (const file of filesToMove) {
          const blob = await downloadFile(file.fileKey);
          const newFileKey = await uploadFile(blob, file.name);
          newToFileKeys.push({ fileKey: newFileKey });
        }

        recordUpdateData[pair.from] = { value: newFromFileKeys };
        recordUpdateData[pair.to] = { value: newToFileKeys };
      }
    }

    // 更新が必要な場合のみレコード更新APIを叩く
    if (needsUpdate) {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
        app: kintone.app.getId(),
        id: recordId,
        record: recordUpdateData
      });
    }
  };

  // ==========================================
  // 【機能A】自動実行用：通常の画面操作での保存完了後に実行
  // ==========================================
  kintone.events.on(['app.record.create.submit.success', 'app.record.edit.submit.success'], async (event) => {
    try {
      await processRecord(event.recordId, event.record);
    } catch (error) {
      console.error('File Move Error:', error);
      alert('ファイルの自動移動処理でエラーが発生しました。');
    }
    return event;
  });

  // ==========================================
  // 【機能B】裏側更新対応：詳細画面が開いた時に未処理ファイルを検知
  // ==========================================
  kintone.events.on('app.record.detail.show', async (event) => {
    const record = event.record;
    let needsMove = false;

    // 未処理の「評価」ファイルが残っているかチェック
    for (const pair of FIELD_PAIRS) {
      const fromField = record[pair.from];
      if (fromField && fromField.value && fromField.value.some(f => f.name.includes('評価'))) {
        needsMove = true;
        break; 
      }
    }

    // 未処理ファイルがあれば移動処理を実行
    if (needsMove) {
      const headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
      if (headerSpace) {
        const msg = document.createElement('div');
        msg.innerText = '保存中...';
        msg.style.color = '#fff';
        msg.style.backgroundColor = '#3498db';
        msg.style.padding = '8px 16px';
        msg.style.margin = '8px';
        msg.style.borderRadius = '4px';
        headerSpace.appendChild(msg);
      }

      try {
        await processRecord(event.recordId, record);
        // 移動が終わったら、最新の状態を表示するために画面をリロード
        location.reload();
      } catch (error) {
        console.error('File Move Error on Detail Show:', error);
        alert('ファイルの自動移動処理でエラーが発生しました。');
      }
    }
    
    return event;
  });

  // ==========================================
  // 【機能C】全グループフィールドの開閉状態を記憶・復元
  // ==========================================
  kintone.events.on([
    'app.record.detail.show',
    'app.record.edit.show',
    'app.record.create.show'
  ], async (event) => {
    const appId = kintone.app.getId();
    const groupCodesKey = `kintone_all_group_codes_${appId}`;
    
    // ① 全グループコードのリストを取得 (初回のみAPIを叩き、以降はブラウザにキャッシュ)
    let groupCodes = JSON.parse(sessionStorage.getItem(groupCodesKey));
    if (!groupCodes || !Array.isArray(groupCodes)) {
      try {
        const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: appId });
        // フォーム情報からタイプが「GROUP」のものだけを抽出
        groupCodes = Object.keys(resp.properties).filter(key => resp.properties[key].type === 'GROUP');
        sessionStorage.setItem(groupCodesKey, JSON.stringify(groupCodes));
      } catch (error) {
        console.error('グループ情報の取得に失敗しました:', error);
        return event;
      }
    }

    // ② それぞれのグループの「前回の開閉状態」を復元
    if (groupCodes && groupCodes.length > 0) {
      groupCodes.forEach(code => {
        const storageKey = `kintone_group_state_${appId}_${code}`;
        const savedState = sessionStorage.getItem(storageKey);
        if (savedState !== null) {
          try {
            // 文字列の 'true' または 'false' に基づいて開閉を制御
            kintone.app.record.setGroupFieldOpen(code, savedState === 'true');
          } catch (e) {
            // フィールドが存在しない等の場合はスキップ
          }
        }
      });
    }

    // ③ 画面上でのクリックを監視し、現在の開閉状態をすべて保存
    // 複数回登録されないようにフラグで制御
    if (!window.kintoneGroupStateListenerAdded) {
      window.kintoneGroupStateListenerAdded = true;
      document.addEventListener('click', async () => {
        // 開閉アニメーション完了を待つために0.3秒待機
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const currentGroupCodes = JSON.parse(sessionStorage.getItem(groupCodesKey));
        if (!currentGroupCodes) return;

        // 全グループの最新の状態を取得して保存
        for (const code of currentGroupCodes) {
          try {
            const currentState = await kintone.app.record.isGroupFieldOpen(code);
            const storageKey = `kintone_group_state_${appId}_${code}`;
            sessionStorage.setItem(storageKey, currentState);
          } catch (e) {
            // APIエラー時はスキップ
          }
        }
      });
    }

    return event;
  });

})();
