'use strict';

const kintoneAdmin = require('./lib/kintone_admin.js');

function parseArgs(argv) {
  let apps = [];
  for (const arg of argv) {
    if (arg.startsWith('--apps=')) {
      const value = arg.slice('--apps='.length).trim();
      if (value !== '') {
        apps = value.split(',').map((id) => id.trim()).filter((id) => id !== '');
      }
    }
  }
  return { apps: apps };
}

function dumpCharCodes(str) {
  const parts = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    parts.push('[' + i + "]='" + ch + "' U+" + code.toString(16).toUpperCase().padStart(4, '0'));
  }
  return parts.join(' ');
}

async function dumpApp(appId) {
  console.log('');
  console.log('========================================');
  console.log('App' + appId + ' の GET /k/v1/preview/app/acl.json 生データ（TEMP_ADMINで取得、書き込みなし）');
  console.log('========================================');

  const data = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });

  console.log('');
  console.log('--- JSON全体（要約せずそのまま） ---');
  console.log(JSON.stringify(data, null, 2));

  console.log('');
  console.log('--- rights配列を1件ずつ、entity.codeを文字単位で確認 ---');
  data.rights.forEach((right, index) => {
    console.log('');
    console.log('[rights[' + index + ']]');
    console.log('  entity.type = ' + JSON.stringify(right.entity ? right.entity.type : null));
    console.log('  entity.code = ' + JSON.stringify(right.entity ? right.entity.code : null));
    if (right.entity && typeof right.entity.code === 'string') {
      console.log('  entity.code の長さ = ' + right.entity.code.length);
      console.log('  entity.code の文字単位: ' + dumpCharCodes(right.entity.code));
      console.log('  "github-bot" という文字列と完全一致するか（===比較）: ' + (right.entity.code === 'github-bot'));
    }
    console.log('  appEditable = ' + right.appEditable);
  });
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('ACL生データ確認を開始します（読み取り専用、kintoneへの書き込みは一切行いません）');

  for (const appId of apps) {
    await dumpApp(appId);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
