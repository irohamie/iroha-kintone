'use strict';

const fs = require('node:fs');
const path = require('node:path');
const kintone = require('./lib/kintone.js');
const verify = require('./lib/verify.js');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'apps.json');
const DEVICE_TYPE_PAIRS = [
  ['desktop', 'js'],
  ['desktop', 'css'],
  ['mobile', 'js'],
  ['mobile', 'css'],
];

function loadEnabledApps() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.apps)) {
    return [];
  }
  return data.apps.filter((app) => app.enabled === true);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function scanExistingFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return new Set();
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const names = new Set();
  for (const entry of entries) {
    if (entry.isFile()) {
      names.add(entry.name);
    }
  }
  return names;
}

function resolveUniqueName(name, usedNames) {
  const count = (usedNames.get(name) || 0) + 1;
  usedNames.set(name, count);

  if (count === 1) {
    return name;
  }

  const ext = path.extname(name);
  const base = path.basename(name, ext);
  return base + '_' + count + ext;
}

async function processDeviceType(app, deviceKey, typeKey, items, fileResults) {
  const dirRelative = path.join(deviceKey, typeKey);
  const dirPath = path.join(REPO_ROOT, app.folder, dirRelative);
  const existingFiles = scanExistingFiles(dirPath);
  const usedNames = new Map();
  const manifestItems = [];
  const writtenNames = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const order = i + 1;

    if (item.type === 'URL') {
      manifestItems.push({ order: order, type: 'URL', url: item.url });
      continue;
    }

    if (item.type === 'FILE') {
      const originalName = item.file.name;
      const finalName = resolveUniqueName(originalName, usedNames);
      const label = app.name + ' ' + deviceKey + '.' + typeKey + ' ' + originalName;

      const buffer = await kintone.apiGetBinary('/k/v1/file.json', { fileKey: item.file.fileKey });
      verify.verifySize(buffer, item.file.size, label);

      ensureDir(dirPath);
      const filePath = path.join(dirPath, finalName);
      fs.writeFileSync(filePath, buffer);

      const md5 = verify.md5Hex(buffer);
      writtenNames.add(finalName);

      fileResults.push({
        appName: app.name,
        fileName: finalName,
        size: buffer.length,
        md5: md5,
        status: '成功',
      });

      manifestItems.push({
        order: order,
        type: 'FILE',
        path: path.join(dirRelative, finalName),
        name: finalName,
        size: buffer.length,
        md5: md5,
      });
      continue;
    }

    throw new Error('未知のtype：' + item.type);
  }

  const leftoverFiles = [];
  for (const existingName of existingFiles) {
    if (!writtenNames.has(existingName)) {
      leftoverFiles.push(path.join(app.folder, dirRelative, existingName));
    }
  }

  return { manifestItems: manifestItems, leftoverFiles: leftoverFiles };
}

async function processApp(app, fileResults) {
  const customize = await kintone.apiGet('/k/v1/app/customize.json', { app: app.appId });

  const manifest = {
    appId: app.appId,
    appName: app.name,
    scope: customize.scope,
    revision: customize.revision,
    pulledAt: new Date().toISOString(),
    desktop: { js: [], css: [] },
    mobile: { js: [], css: [] },
  };

  const allLeftoverFiles = [];

  for (const pair of DEVICE_TYPE_PAIRS) {
    const deviceKey = pair[0];
    const typeKey = pair[1];
    const items = (customize[deviceKey] && customize[deviceKey][typeKey]) || [];
    const result = await processDeviceType(app, deviceKey, typeKey, items, fileResults);
    manifest[deviceKey][typeKey] = result.manifestItems;
    allLeftoverFiles.push(...result.leftoverFiles);
  }

  const appDir = path.join(REPO_ROOT, app.folder);
  ensureDir(appDir);
  const manifestPath = path.join(appDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { leftoverFiles: allLeftoverFiles };
}

async function main() {
  const apps = loadEnabledApps();
  console.log('JS/CSSコードの取得を開始します（対象：' + apps.length + 'アプリ）');

  const fileResults = [];
  const appErrors = [];
  const allLeftoverFiles = [];

  for (const app of apps) {
    try {
      const result = await processApp(app, fileResults);
      allLeftoverFiles.push(...result.leftoverFiles);
      console.log(app.appId + '：' + app.name + '：成功');
    } catch (error) {
      appErrors.push({ appId: app.appId, appName: app.name, message: error.message });
      fileResults.push({
        appName: app.name,
        fileName: '(処理中止)',
        size: 0,
        md5: '',
        status: 'エラー：' + error.message,
      });
      console.log(app.appId + '：' + app.name + '：エラー：' + error.message);
    }
  }

  console.log('');
  console.log('=== ファイル取得結果 ===');
  console.log(
    verify.formatTable(
      ['アプリ名', 'ファイル名', 'バイト数', 'MD5', '成否'],
      fileResults.map((r) => [r.appName, r.fileName, String(r.size), r.md5, r.status])
    )
  );

  if (allLeftoverFiles.length > 0) {
    console.log('');
    console.log('=== kintoneに存在しない残存ファイル（削除はしていません） ===');
    for (const f of allLeftoverFiles) {
      console.log(f);
    }
  }

  console.log('');
  console.log('総アプリ数：' + apps.length + '件（エラー：' + appErrors.length + '件）');

  if (appErrors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
