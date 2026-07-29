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

async function checkApp(appId) {
  console.log('');
  console.log('--- App' + appId + '：TEMP_ADMINでGET /k/v1/app/customize.json ---');
  try {
    const data = await kintoneAdmin.apiGet('/k/v1/app/customize.json', { app: appId });
    console.log('成功：scope=' + data.scope + '、revision=' + data.revision);
  } catch (error) {
    console.log('失敗：' + error.message);
  }
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('TEMP_ADMINでの運用環境customize.json取得確認を開始します（読み取り専用）');

  for (const appId of apps) {
    await checkApp(appId);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
