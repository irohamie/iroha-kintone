(function() {
    'use strict';

    // 確定したLINE LIFF URL
    const LIFF_URL = "https://liff.line.me/2010536733-sHM8Fv5Y"; 

    // ランダムな文字列（UUID v4）を生成する関数
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ボタンを生成する共通関数
    function createUrlButton(buttonText, fieldCode, appId, recordId) {
        const button = document.createElement('button');
        button.innerText = buttonText + 'URL生成';
        button.style.margin = '5px';
        button.style.padding = '8px 16px';
        button.style.backgroundColor = '#3498db';
        button.style.color = '#fff';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';

        // ボタンクリック時の処理
        button.onclick = function() {
            const token = generateUUID();
            // 日本語のフィールドコードをURLに安全に含めるため encodeURIComponent を使用
            const fullLiffUrl = LIFF_URL + "?appId=" + appId + "&token=" + token + "&field=" + encodeURIComponent(fieldCode);

            const body = {
                app: appId,
                id: recordId,
                record: {
                    token: { value: token },
                    liff_url: { value: fullLiffUrl }
                }
            };

            kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', body).then(function(resp) {
                alert(buttonText + '用の署名URLを生成しました。画面を再読み込みします。');
                location.reload();
            }).catch(function(error) {
                alert('URLの生成に失敗しました: ' + error.message);
            });
        };
        return button;
    }

    // 詳細画面が表示されたときの処理
    kintone.events.on('app.record.detail.show', function(event) {
        const appId = kintone.app.getId();
        const recordId = kintone.app.record.getId();
        
        // 配置先のスペースを取得（要素ID: button_space）
        const space = kintone.app.record.getSpaceElement('button_space');
        
        // スペースが見つからない場合は何もしない
        if (!space) return event;

        // アプリIDに応じて、スペースにボタンを配置する
        if (appId === 207) {
            space.appendChild(createUrlButton('前期立案署名', '前期立案署名', appId, recordId));
            space.appendChild(createUrlButton('前期評価署名', '前期評価署名', appId, recordId));
            space.appendChild(createUrlButton('後期立案署名', '後期立案署名', appId, recordId));
            space.appendChild(createUrlButton('後期評価署名', '後期評価署名', appId, recordId));
        } else if (appId === 42) {
            space.appendChild(createUrlButton('署名', '署名', appId, recordId));
            space.appendChild(createUrlButton('アセス署名', '署名2', appId, recordId));
        }

        return event;
    });
})();
