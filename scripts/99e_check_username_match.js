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

function reportUsername() {
  console.log('=== KINTONE_USERNAME の確認（パスワードは出力しません） ===');
  const username = process.env.KINTONE_USERNAME;
  if (username === undefined) {
    console.log('KINTONE_USERNAME は設定されていません');
    return;
  }
  console.log('値（そのまま、JSON.stringify）: ' + JSON.stringify(username));
  console.log('文字数: ' + username.length);
  console.log('先頭が空白文字を含むか: ' + /^\s/.test(username));
  console.log('末尾が空白文字を含むか: ' + /\s$/.test(username));
}

async function dumpGithubEntities(appId) {
  console.log('');
  console.log('=== App' + appId + ' の preview ACL：entity.type=USER かつ codeに github/GitHub を含むエントリ ===');
  const data = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
  const matches = data.rights.filter((right) => {
    return (
      right.entity &&
      right.entity.type === 'USER' &&
      typeof right.entity.code === 'string' &&
      /github/i.test(right.entity.code)
    );
  });

  if (matches.length === 0) {
    console.log('該当するエントリはありませんでした');
    return;
  }

  matches.forEach((right, index) => {
    console.log(
      '[' + index + '] entity.code = ' + JSON.stringify(right.entity.code) + '、appEditable = ' + right.appEditable
    );
  });
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  reportUsername();

  for (const appId of apps) {
    await dumpGithubEntities(appId);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
