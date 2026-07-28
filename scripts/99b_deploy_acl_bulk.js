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

async function determineTargets(appIds, appNames) {
  const targets = [];
  const results = [];

  for (const appId of appIds) {
    const appName = appNames.get(appId) || '(名称不明)';

    const production = await kintoneAdmin.apiGet('/k/v1/app/acl.json', { app: appId });
    const productionGrant = findGrant(production.rights);

    if (productionGrant && productionGrant.appEditable === true) {
      results.push({
        appId: appId,
        appName: appName,
        result: 'スキップ',
        detail: '運用環境に既にappEditable:trueが反映済み',
      });
      continue;
    }

    const preview = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
    const previewGrant = findGrant(preview.rights);

    if (!previewGrant || previewGrant.appEditable !== true) {
      results.push({
        appId: appId,
        appName: appName,
        result: 'エラー',
        detail: 'テスト環境でgithub-botのappEditable:trueが確認できないため対象から除外しました',
      });
      continue;
    }

    targets.push({ appId: appId, appName: appName, revision: preview.revision });
  }

  return { targets: targets, results: results };
}

async function deployBatch(targets) {
  await kintoneAdmin.apiPost('/k/v1/preview/app/deploy.json', {
    apps: targets.map((t) => ({ app: Number(t.appId), revision: Number(t.revision) })),
  });
}

async function waitForDeployBatch(targets) {
  const pendingIds = new Set(targets.map((t) => t.appId));
  const statusById = new Map();

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && pendingIds.size > 0; attempt++) {
    const params = {};
    let i = 0;
    for (const appId of pendingIds) {
      params['apps[' + i + '].app'] = appId;
      i++;
    }

    const result = await kintoneAdmin.apiGet('/k/v1/preview/app/deploy.json', params);
    const statusList = result.apps || [];

    for (const entry of statusList) {
      const appIdStr = String(entry.app);
      if (entry.status === 'SUCCESS' || entry.status === 'FAIL' || entry.status === 'CANCELLED') {
        statusById.set(appIdStr, entry.status);
        pendingIds.delete(appIdStr);
      }
    }

    if (pendingIds.size > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  for (const appId of pendingIds) {
    statusById.set(appId, 'TIMEOUT');
  }

  return statusById;
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
  const { targets, results } = await determineTargets(apps, appNames);

  console.log(
    '反映が必要なアプリ：' + targets.length + '件（スキップ・除外：' + (apps.length - targets.length) + '件）'
  );

  if (targets.length === 0) {
    printReport(sortByOriginalOrder(apps, results));
    if (results.some((r) => r.result === 'エラー')) {
      process.exit(1);
    }
    return;
  }

  try {
    await deployBatch(targets);
  } catch (error) {
    for (const t of targets) {
      results.push({
        appId: t.appId,
        appName: t.appName,
        result: 'エラー',
        detail: 'deployの一括送信に失敗：' + error.message,
      });
    }
    printReport(sortByOriginalOrder(apps, results));
    process.exit(1);
    return;
  }

  const statusById = await waitForDeployBatch(targets);

  for (const t of targets) {
    const status = statusById.get(t.appId);

    if (status !== 'SUCCESS') {
      results.push({
        appId: t.appId,
        appName: t.appName,
        result: 'エラー',
        detail: 'deployのステータスが' + status + 'になりました',
      });
      continue;
    }

    try {
      const production = await kintoneAdmin.apiGet('/k/v1/app/acl.json', { app: t.appId });
      const grant = findGrant(production.rights);

      if (!grant || grant.appEditable !== true) {
        results.push({
          appId: t.appId,
          appName: t.appName,
          result: 'エラー',
          detail: '運用環境への反映後、github-botのappEditable:trueを確認できませんでした',
        });
      } else {
        results.push({
          appId: t.appId,
          appName: t.appName,
          result: '成功',
          detail: '',
        });
      }
    } catch (error) {
      results.push({
        appId: t.appId,
        appName: t.appName,
        result: 'エラー',
        detail: '反映後の検証に失敗：' + error.message,
      });
    }
  }

  printReport(sortByOriginalOrder(apps, results));

  if (results.some((r) => r.result === 'エラー')) {
    process.exit(1);
  }
}

function sortByOriginalOrder(apps, results) {
  const order = new Map(apps.map((appId, index) => [appId, index]));
  return results.slice().sort((a, b) => order.get(a.appId) - order.get(b.appId));
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
