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

async function dumpApp(appId) {
  console.log('');
  console.log('========================================');
  console.log('App' + appId + ' の GET /k/v1/app/acl.json（運用環境）生データ（TEMP_ADMINで取得、書き込みなし）');
  console.log('========================================');

  const data = await kintoneAdmin.apiGet('/k/v1/app/acl.json', { app: appId });

  console.log('');
  console.log('--- rights配列を1件ずつ ---');
  data.rights.forEach((right, index) => {
    console.log('');
    console.log('[rights[' + index + ']]');
    console.log('  entity.type = ' + JSON.stringify(right.entity ? right.entity.type : null));
    console.log('  entity.code = ' + JSON.stringify(right.entity ? right.entity.code : null));
    console.log('  appEditable = ' + right.appEditable);
  });

  console.log('');
  console.log('revision = ' + data.revision);
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('運用環境ACL生データ確認を開始します（読み取り専用、kintoneへの書き込みは一切行いません）');

  for (const appId of apps) {
    await dumpApp(appId);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
