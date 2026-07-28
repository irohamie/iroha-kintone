'use strict';

const fs = require('node:fs');
const path = require('node:path');
const kintone = require('./lib/kintone.js');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'apps.json');
const DEFAULT_ENABLED_IDS = ['10', '42', '207', '219', '225', '227', '228', '231'];
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

function loadExistingConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  if (raw.trim() === '') {
    return null;
  }
  return JSON.parse(raw);
}

function scanExistingFolders() {
  const map = new Map();
  const entries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^App(\d+)_/);
    if (match) {
      map.set(match[1], entry.name);
    }
  }
  return map;
}

function stripLeadingSymbols(name) {
  return name.replace(/^[^\p{L}\p{N}]+/u, '');
}

function sanitizeForbiddenChars(name) {
  return name.replace(/[\/\\:*?"<>|\x00-\x1F]/g, '_');
}

function collapseWhitespace(name) {
  return name.trim().replace(/\s+/g, '_');
}

function generateFolderName(appId, name, existingFolders) {
  if (existingFolders.has(appId)) {
    return existingFolders.get(appId);
  }

  let base = String(name);
  base = stripLeadingSymbols(base);
  base = sanitizeForbiddenChars(base);
  base = collapseWhitespace(base);

  if (base === '') {
    base = 'noname';
  }

  return 'App' + appId + '_' + base;
}

async function fetchAllApps() {
  const apps = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await kintone.apiGet('/k/v1/apps.json', { limit: PAGE_LIMIT, offset: offset });
    const pageApps = Array.isArray(result.apps) ? result.apps : [];
    apps.push(...pageApps);

    if (pageApps.length < PAGE_LIMIT) {
      return apps;
    }
    offset += PAGE_LIMIT;
  }

  throw new Error('アプリ一覧のページングが' + MAX_PAGES + '回を超えました。無限ループ防止のため中止します');
}

function printReport(apps, newlyFound, missingApps) {
  console.log('');
  console.log('=== 新規に見つかったアプリ ===');
  if (newlyFound.length === 0) {
    console.log('なし');
  } else {
    for (const app of newlyFound) {
      console.log(app.appId + '：' + app.name);
    }
  }

  console.log('');
  console.log('=== 前回はあったが今回見つからなかったアプリ ===');
  if (missingApps.length === 0) {
    console.log('なし');
  } else {
    for (const app of missingApps) {
      console.log(app.appId + '：' + app.name);
    }
  }

  console.log('');
  console.log('=== enabled: true のアプリ一覧 ===');
  const enabledApps = apps.filter((app) => app.enabled);
  if (enabledApps.length === 0) {
    console.log('なし');
  } else {
    for (const app of enabledApps) {
      console.log(app.appId + '：' + app.name + '（' + app.folder + '）');
    }
  }

  console.log('');
  console.log('総アプリ数：' + apps.length + '件');
}

async function main() {
  console.log('kintone アプリ一覧の取得を開始します');

  const existingConfig = loadExistingConfig();
  const isFirstRun = existingConfig === null;
  const previousAppsById = new Map();

  if (existingConfig && Array.isArray(existingConfig.apps)) {
    for (const app of existingConfig.apps) {
      previousAppsById.set(String(app.appId), app);
    }
  }

  const existingFolders = scanExistingFolders();
  const rawApps = await fetchAllApps();
  console.log('取得したアプリ総数：' + rawApps.length + '件');

  const newlyFound = [];
  const resultApps = [];

  for (const rawApp of rawApps) {
    const appId = String(rawApp.appId);
    const name = rawApp.name;
    const spaceId = rawApp.spaceId !== undefined ? rawApp.spaceId : null;
    const previous = previousAppsById.get(appId);

    let enabled;
    let note;

    if (previous) {
      enabled = previous.enabled;
      note = previous.note;
    } else {
      enabled = isFirstRun ? DEFAULT_ENABLED_IDS.indexOf(appId) !== -1 : false;
      note = '';
      newlyFound.push({ appId: appId, name: name });
    }

    const folder = generateFolderName(appId, name, existingFolders);

    resultApps.push({
      appId: appId,
      name: name,
      folder: folder,
      spaceId: spaceId,
      enabled: enabled,
      note: note,
    });
  }

  resultApps.sort((a, b) => Number(a.appId) - Number(b.appId));

  const currentIds = new Set(resultApps.map((app) => app.appId));
  const missingApps = [];
  for (const [appId, prevApp] of previousAppsById.entries()) {
    if (!currentIds.has(appId)) {
      missingApps.push({ appId: appId, name: prevApp.name });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl: process.env.KINTONE_BASE_URL || '',
    apps: resultApps,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');

  printReport(resultApps, newlyFound, missingApps);
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
