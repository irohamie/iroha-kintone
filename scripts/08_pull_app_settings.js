'use strict';

const fs = require('node:fs');
const path = require('node:path');
const kintone = require('./lib/kintone.js');
const verify = require('./lib/verify.js');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'apps.json');

const ENDPOINTS = [
  { key: 'fields', path: '/k/v1/preview/app/form/fields.json' },
  { key: 'layout', path: '/k/v1/preview/app/form/layout.json' },
  { key: 'views', path: '/k/v1/preview/app/views.json' },
  { key: 'settings', path: '/k/v1/preview/app/settings.json' },
  { key: 'acl', path: '/k/v1/preview/app/acl.json' },
];

function loadEnabledApps() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.apps)) {
    return [];
  }
  return data.apps.filter((app) => app.enabled === true);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

async function fetchEndpoint(app, endpoint) {
  const data = await kintone.apiGet(endpoint.path, { app: app.appId });
  const sorted = sortKeysDeep(data);
  const settingsDir = path.join(REPO_ROOT, app.folder, 'settings');
  fs.mkdirSync(settingsDir, { recursive: true });
  const filePath = path.join(settingsDir, endpoint.key + '.json');
  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  return sorted;
}

async function processApp(app) {
  const endpointResults = {};
  const errors = [];

  for (const endpoint of ENDPOINTS) {
    try {
      endpointResults[endpoint.key] = await fetchEndpoint(app, endpoint);
    } catch (error) {
      errors.push(endpoint.key + '：' + error.message);
    }
  }

  const fieldCount = endpointResults.fields && endpointResults.fields.properties
    ? Object.keys(endpointResults.fields.properties).length
    : null;
  const viewCount = endpointResults.views && endpointResults.views.views
    ? Object.keys(endpointResults.views.views).length
    : null;

  return {
    appId: app.appId,
    appName: app.name,
    fieldCount: fieldCount,
    viewCount: viewCount,
    errors: errors,
  };
}

async function main() {
  const apps = loadEnabledApps();
  console.log('アプリ設定（フィールド・レイアウト・ビュー・一般設定・アクセス権）の取得を開始します');
  console.log('対象：' + apps.length + 'アプリ');

  const results = [];
  let hasError = false;

  for (const app of apps) {
    const result = await processApp(app);
    results.push(result);

    if (result.errors.length > 0) {
      hasError = true;
      console.log(app.appId + '：' + app.name + '：一部エラー：' + result.errors.join(' / '));
    } else {
      console.log(app.appId + '：' + app.name + '：成功');
    }
  }

  console.log('');
  console.log('=== アプリ設定 取得結果 ===');
  console.log(
    verify.formatTable(
      ['アプリID', 'アプリ名', 'フィールド数', 'ビュー数', 'エラー'],
      results.map((r) => [
        r.appId,
        r.appName,
        r.fieldCount === null ? '取得失敗' : String(r.fieldCount),
        r.viewCount === null ? '取得失敗' : String(r.viewCount),
        r.errors.length === 0 ? 'なし' : r.errors.join(' / '),
      ])
    )
  );

  if (hasError) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
