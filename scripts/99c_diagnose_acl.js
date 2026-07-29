'use strict';

const fs = require('node:fs');
const path = require('node:path');
const kintoneAdmin = require('./lib/kintone_admin.js');
const kintone = require('./lib/kintone.js');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'apps.json');
const GRANT_ENTITY_CODE = process.env.KINTONE_USERNAME || 'github-bot';

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

function findGrant(rights) {
  if (!Array.isArray(rights)) return null;
  for (const right of rights) {
    if (right.entity && right.entity.type === 'USER' && right.entity.code === GRANT_ENTITY_CODE) {
      return right;
    }
  }
  return null;
}

async function safeGet(fn) {
  try {
    const value = await fn();
    return { ok: true, value: value, error: null };
  } catch (error) {
    return { ok: false, value: null, error: error.message };
  }
}

async function diagnoseApp(appId, appName) {
  const row = { appId: appId, appName: appName };

  const preview = await safeGet(() => kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId }));
  if (preview.ok) {
    const grant = findGrant(preview.value.rights);
    row.previewRevision = preview.value.revision;
    row.previewAppEditable = grant ? String(grant.appEditable) : '(付与なし)';
  } else {
    row.previewRevision = '(取得失敗)';
    row.previewAppEditable = '(取得失敗：' + preview.error + ')';
  }

  const prodByAdmin = await safeGet(() => kintoneAdmin.apiGet('/k/v1/app/acl.json', { app: appId }));
  if (prodByAdmin.ok) {
    const grant = findGrant(prodByAdmin.value.rights);
    row.prodRevisionByAdmin = prodByAdmin.value.revision;
    row.prodAppEditableByAdmin = grant ? String(grant.appEditable) : '(付与なし)';
  } else {
    row.prodRevisionByAdmin = '(取得失敗)';
    row.prodAppEditableByAdmin = '(取得失敗：' + prodByAdmin.error + ')';
  }

  const prodByBot = await safeGet(() => kintone.apiGet('/k/v1/app/acl.json', { app: appId }));
  if (prodByBot.ok) {
    const grant = findGrant(prodByBot.value.rights);
    row.botOwnAclCheck = '成功（' + (grant ? 'appEditable=' + grant.appEditable : '付与なし') + '）';
  } else {
    row.botOwnAclCheck = '失敗：' + prodByBot.error;
  }

  const botCustomize = await safeGet(() => kintone.apiGet('/k/v1/app/customize.json', { app: appId }));
  row.botCustomizeCheck = botCustomize.ok ? '成功' : '失敗：' + botCustomize.error;

  return row;
}

function printReport(rows) {
  console.log('');
  console.log('=== ACL診断結果（すべて読み取りのみ、書き込みは行っていません） ===');
  for (const row of rows) {
    console.log('');
    console.log('--- App' + row.appId + '（' + row.appName + '） ---');
    console.log('テスト環境ACL（TEMP_ADMINで取得）　　　　：revision=' + row.previewRevision + '、github-botのappEditable=' + row.previewAppEditable);
    console.log('運用環境ACL（TEMP_ADMINで取得）　　　　　：revision=' + row.prodRevisionByAdmin + '、github-botのappEditable=' + row.prodAppEditableByAdmin);
    console.log('運用環境ACL（github-bot自身の資格情報で取得）：' + row.botOwnAclCheck);
    console.log('運用環境customize.json（github-bot自身の資格情報で取得）：' + row.botCustomizeCheck);
  }
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('ACL診断を開始します（読み取り専用、kintoneへの書き込みは一切行いません）');
  console.log('対象アプリ数：' + apps.length + '件');

  const appNames = loadAppNames();
  const rows = [];
  for (const appId of apps) {
    const appName = appNames.get(appId) || '(名称不明)';
    rows.push(await diagnoseApp(appId, appName));
  }

  printReport(rows);
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
