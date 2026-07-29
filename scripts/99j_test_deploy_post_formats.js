'use strict';

const kintoneAdmin = require('./lib/kintone_admin.js');

function parseArgs(argv) {
  let app = null;
  for (const arg of argv) {
    if (arg.startsWith('--app=')) {
      app = arg.slice('--app='.length).trim();
    }
  }
  return { app: app };
}

async function tryBody(label, body) {
  console.log('');
  console.log('--- ' + label + ' ---');
  console.log('送信body：' + JSON.stringify(body));
  try {
    const result = await kintoneAdmin.apiPost('/k/v1/preview/app/deploy.json', body);
    console.log('成功：' + JSON.stringify(result));
  } catch (error) {
    console.log('失敗：' + error.message);
  }
}

async function main() {
  const { app } = parseArgs(process.argv.slice(2));

  if (!app) {
    console.log('対象アプリが指定されていません（--app=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('App' + app + ' に対してdeploy.jsonのPOSTボディ形式を比較確認します');
  console.log('（注意：これは書き込み系APIです。成功した場合、ACLが実際に運用環境へデプロイされます）');

  const preview = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: app });
  console.log('現在のpreview revision：' + preview.revision);

  await tryBody(
    '形式B：apps がアプリIDのみのフラット配列',
    { apps: [Number(app)] }
  );
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
