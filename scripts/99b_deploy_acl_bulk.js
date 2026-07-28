'use strict';

const fs = require('node:fs');
const path = require('node:path');
const kintoneAdmin = require('./lib/kintone_admin.js');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'apps.json');
const GRANT_ENTITY_CODE = 'github-bot';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;

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

function loadAppNames() {
  const map = new Map();
  if (!fs.existsSync(CONFIG_PATH)) {
    return map;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data.apps)) {
    for (const app of data.apps) {
      map.set(String(app.appId), app.name);
    }
  }
  return map;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findGrant(rights) {
  for (const right of rights) {
    if (
      right.entity &&
      right.entity.type === 'USER' &&
      right.entity.code === GRANT_ENTITY_CODE
    ) {
      return right;
    }
  }
  return null;
}

async function waitForDeploy(appId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const result = await kintoneAdmin.apiGet('/k/v1/preview/app/deploy.json', {
      'apps[0].app': appId,
    });
    const status = result.apps && result.apps[0] ? result.apps[0].status : undefined;

    if (status === 'SUCCESS') {
      return;
    }
    if (status === 'FAIL' || status === 'CANCELLED') {
      throw new Error('deployのステータスが' + status + 'になりました');
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('deployの完了待ちが' + MAX_POLL_ATTEMPTS + '回のポーリングを超えました');
}

async function processApp(appId, appName) {
  const production = await kintoneAdmin.apiGet('/k/v1/app/acl.json', { app: appId });
  const alreadyDeployedGrant = findGrant(production.rights);

  if (alreadyDeployedGrant && alreadyDeployedGrant.appEditable === true) {
    return {
      appId: appId,
      appName: appName,
      result: 'スキップ',
      detail: '運用環境に既にappEditable:trueが反映済み',
    };
  }

  const preview = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
  const previewGrant = findGrant(preview.rights);

  if (!previewGrant || previewGrant.appEditable !== true) {
    return {
      appId: appId,
      appName: appName,
      result: 'エラー',
      detail: 'テスト環境でgithub-botのappEditable:trueが確認できないため反映を中止しました',
    };
  }

  await kintoneAdmin.apiPost('/k/v1/preview/app/deploy.json', {
    apps: [{ app: Number(appId), revision: Number(preview.revision) }],
  });

  await waitForDeploy(appId);

  const productionAfter = await kintoneAdmin.apiGet('/k/v1/app/acl.json', { app: appId });
  const productionGrant = findGrant(productionAfter.rights);

  if (!productionGrant || productionGrant.appEditable !== true) {
    return {
      appId: appId,
      appName: appName,
      result: 'エラー',
      detail: '運用環境への反映後、github-botのappEditable:trueを確認できませんでした',
    };
  }

  return {
    appId: appId,
    appName: appName,
    result: '成功',
    detail: '',
  };
}

function printReport(results) {
  console.log('');
  console.log('=== ACL運用環境反映 結果 ===');
  console.log('アプリID\tアプリ名\t結果\t詳細');
  for (const r of results) {
    console.log(r.appId + '\t' + r.appName + '\t' + r.result + '\t' + r.detail);
  }

  const success = results.filter((r) => r.result === '成功').length;
  const skipped = results.filter((r) => r.result === 'スキップ').length;
  const errors = results.filter((r) => r.result === 'エラー').length;

  console.log('');
  console.log(
    '総数：' + results.length + '件（成功：' + success + '件／スキップ（反映済み）：' + skipped + '件／エラー：' + errors + '件）'
  );
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('ACLの運用環境への反映を開始します');
  console.log('対象アプリ数：' + apps.length + '件');

  const appNames = loadAppNames();
  const results = [];

  for (const appId of apps) {
    const appName = appNames.get(appId) || '(名称不明)';
    try {
      const result = await processApp(appId, appName);
      results.push(result);
      console.log(appId + '：' + result.result);
    } catch (error) {
      results.push({
        appId: appId,
        appName: appName,
        result: 'エラー',
        detail: error.message,
      });
      console.log(appId + '：エラー：' + error.message);
    }
  }

  printReport(results);

  const hasError = results.some((r) => r.result === 'エラー');
  if (hasError) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
