'use strict';

const kintone = require('./lib/kintone.js');

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

function nowJst() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '/' + get('month') + '/' + get('day') + ' ' + get('hour') + ':' + get('minute') + ':' + get('second');
}

async function callAndLog(label, fn) {
  const before = nowJst();
  try {
    await fn();
    const after = nowJst();
    console.log(label + '：成功（開始' + before + ' 〜 終了' + after + ' JST）');
  } catch (error) {
    const after = nowJst();
    console.log(label + '：失敗（開始' + before + ' 〜 終了' + after + ' JST）：' + error.message);
  }
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('日時記録付き再現確認を開始します（読み取り専用、書き込みは一切行いません）');
  console.log('現在時刻（JST）：' + nowJst());

  for (const appId of apps) {
    console.log('');
    console.log('=== App' + appId + ' ===');
    await callAndLog('GET /k/v1/app/acl.json?app=' + appId, () => kintone.apiGet('/k/v1/app/acl.json', { app: appId }));
    await callAndLog('GET /k/v1/app/customize.json?app=' + appId, () => kintone.apiGet('/k/v1/app/customize.json', { app: appId }));
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
