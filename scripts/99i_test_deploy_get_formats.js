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

async function tryFormat(label, buildParams, apps) {
  console.log('');
  console.log('--- ' + label + ' ---');
  const params = buildParams(apps);
  console.log('パラメータ：' + JSON.stringify(params));
  try {
    const result = await kintoneAdmin.apiGet('/k/v1/preview/app/deploy.json', params);
    console.log('成功：' + JSON.stringify(result));
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

  console.log('deploy.json のGETパラメータ形式を比較確認します（読み取り専用）');

  await tryFormat(
    '形式A：apps[n].app=ID（ドキュメント記載の形式、これまで使用）',
    (list) => {
      const p = {};
      list.forEach((appId, index) => {
        p['apps[' + index + '].app'] = appId;
      });
      return p;
    },
    apps
  );

  await tryFormat(
    '形式B：apps[n]=ID（アプリIDのみのフラット配列）',
    (list) => {
      const p = {};
      list.forEach((appId, index) => {
        p['apps[' + index + ']'] = appId;
      });
      return p;
    },
    apps
  );
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
