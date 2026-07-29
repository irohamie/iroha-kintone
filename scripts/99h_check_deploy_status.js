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

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('デプロイステータス確認を開始します（読み取り専用、kintoneへの書き込みは一切行いません）');

  const params = {};
  apps.forEach((appId, index) => {
    params['apps[' + index + '].app'] = appId;
  });

  try {
    const result = await kintoneAdmin.apiGet('/k/v1/preview/app/deploy.json', params);
    console.log('');
    console.log('--- GET /k/v1/preview/app/deploy.json 生レスポンス ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('取得に失敗しました：' + error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
