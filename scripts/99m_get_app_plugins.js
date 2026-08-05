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

async function getPlugins(path, appId) {
  const data = await kintone.apiGet(path, { app: appId });
  return data;
}

async function checkApp(appId) {
  console.log('');
  console.log('=== App' + appId + ' のプラグイン ===');

  console.log('--- 運用環境（GET /k/v1/app/plugins.json） ---');
  try {
    const production = await getPlugins('/k/v1/app/plugins.json', appId);
    const plugins = production.plugins || [];
    if (plugins.length === 0) {
      console.log('プラグインは追加されていません');
    } else {
      for (const plugin of plugins) {
        console.log('id=' + plugin.id + '、name=' + plugin.name);
      }
    }
    console.log('（生データ）' + JSON.stringify(production));
  } catch (error) {
    console.log('取得失敗：' + error.message);
  }

  console.log('--- テスト環境（GET /k/v1/preview/app/plugins.json） ---');
  try {
    const preview = await getPlugins('/k/v1/preview/app/plugins.json', appId);
    const plugins = preview.plugins || [];
    if (plugins.length === 0) {
      console.log('プラグインは追加されていません');
    } else {
      for (const plugin of plugins) {
        console.log('id=' + plugin.id + '、name=' + plugin.name);
      }
    }
    console.log('（生データ）' + JSON.stringify(preview));
  } catch (error) {
    console.log('取得失敗：' + error.message);
  }
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('アプリのプラグイン一覧取得を開始します（読み取り専用）');
  console.log('対象：' + apps.join(', '));

  for (const appId of apps) {
    await checkApp(appId);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
