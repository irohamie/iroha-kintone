(function() {
  'use strict';

  kintone.events.on('app.record.detail.show', async function(event) {
    const record = event.record;
    
    // フィールドコードの設定
    const signFieldCode = '利用者サイン原本';  
    const tsImageFieldCode = '利用者サイン';   
    const keyFieldCode = 'サインファイルキー';   

    const hasFile = record[signFieldCode].value && record[signFieldCode].value.length > 0;
    const currentFileKey = hasFile ? record[signFieldCode].value[0].fileKey : '';
    const savedFileKey = record[keyFieldCode].value || '';

    if (hasFile && currentFileKey !== savedFileKey) {
      try {
        const downloadUrl = '/k/v1/file.json?fileKey=' + currentFileKey;
        const dlRes = await fetch(downloadUrl, { headers: {'X-Requested-With': 'XMLHttpRequest'} });
        const dlBlob = await dlRes.blob();
        
        const img = new Image();
        const imgUrl = URL.createObjectURL(dlBlob);
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imgUrl;
        });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 縮小率を設定（90%）
        const scale = 0.9;

        // キャンバスのサイズを元の設定の「90%」にする
        canvas.width = img.width * scale;
        canvas.height = (img.height + 150) * scale;
        
        // 背景を白で塗りつぶす
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 元のサインを「90%」のサイズで描画
        ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);

        // 青色の下線を引く（位置と太さも90%に）
        ctx.beginPath();
        ctx.moveTo(0, (img.height + 30) * scale);          
        ctx.lineTo(canvas.width, (img.height + 30) * scale); 
        ctx.strokeStyle = '#0000EE';             
        ctx.lineWidth = 8 * scale; // 8pxの90% = 7.2px                       
        ctx.stroke();

        const now = new Date();
        const tsString = `(${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
                         `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:` +
                         `${String(now.getSeconds()).padStart(2, '0')} GMT+9)`;

        // 青色のテキストを描画（位置と文字サイズも90%に）
        ctx.fillStyle = '#0000EE';               
        ctx.font = 'bold 63px sans-serif'; // 70pxの90% = 63px
        ctx.fillText(tsString, 20 * scale, (img.height + 110) * scale); 

        const uploadBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

        const formData = new FormData();
        formData.append('__REQUEST_TOKEN__', kintone.getRequestToken());
        formData.append('file', uploadBlob, 'timestamped_sign.png');
        
        const ulRes = await fetch('/k/v1/file.json', {
          method: 'POST',
          headers: {'X-Requested-With': 'XMLHttpRequest'},
          body: formData
        });
        const ulJson = await ulRes.json();
        const newTimestampFileKey = ulJson.fileKey;

        const body = {
          app: kintone.app.getId(),
          id: kintone.app.record.getId(),
          record: {
            [tsImageFieldCode]: { value: [{ fileKey: newTimestampFileKey }] },
            [keyFieldCode]: { value: currentFileKey } 
          }
        };

        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', body);
        
        location.reload();
        
      } catch (error) {
        console.error('画像の合成または保存に失敗しました', error);
      }
    }

    return event;
  });

  const hideEvents = ['app.record.create.show', 'app.record.edit.show', 'app.record.detail.show'];
  kintone.events.on(hideEvents, function(event) {
    kintone.app.record.setFieldShown('サインファイルキー', false);
    return event;
  });

})();