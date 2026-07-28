'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const kintoneAdmin = require('./lib/kintone_admin.js');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'apps.json');
const GRANT_ENTITY_CODE = 'github-bot';

const DEFAULT_APP_IDS = [
  '10', '11', '30', '42', '46', '50', '67', '128', '133', '137', '139', '141',
  '142', '144', '146', '147', '160', '161', '162', '163', '207', '211', '216',
  '219', '220', '221', '222', '225', '229', '230', '231', '232', '233', '236',
  '237',
];

function parseArgs(argv) {
  let apps = DEFAULT_APP_IDS;
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

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function runGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function backupAndPush(appId, aclData) {
  const dirName = '_backup_before/' + todayCompact() + '_App' + appId + '_acl';
  const dirPath = path.join(REPO_ROOT, dirName);
  const filePath = path.join(dirPath, 'acl_before.json');

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(aclData, null, 2) + '\n', 'utf8');

  const relativePath = path.join(dirName, 'acl_before.json');
  runGit(['add', relativePath]);

  const status = runGit(['status', '--porcelain', '--', relativePath]).trim();
  if (status === '') {
    return true;
  }

  runGit(['commit', '-m', 'ACL変更前退避：App' + appId + ' ' + new Date().toISOString().slice(0, 10)]);
  runGit(['push']);
  return true;
}

function findExistingGrant(rights) {
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

function buildNewRight() {
  return {
    entity: { type: 'USER', code: GRANT_ENTITY_CODE },
    appEditable: true,
    recordViewable: false,
    recordAddable: false,
    recordEditable: false,
    recordDeletable: false,
    recordImportable: false,
    recordExportable: false,
    includeSubs: false,
  };
}

async function processApp(appId, appName) {
  const before = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
  const beforeRights = before.rights;
  const beforeCount = beforeRights.length;

  const existing = findExistingGrant(beforeRights);
  if (existing && existing.appEditable === true) {
    return {
      appId: appId,
      appName: appName,
      beforeCount: beforeCount,
      afterCount: beforeCount,
      result: '変更不要',
      detail: 'github-botには既にappEditable:trueが付与済み',
    };
  }

  try {
    backupAndPush(appId, before);
  } catch (backupError) {
    return {
      appId: appId,
      appName: appName,
      beforeCount: beforeCount,
      afterCount: beforeCount,
      result: 'エラー',
      detail: '変更前退避のコミット・pushに失敗したため書き込みを中止：' + backupError.message,
    };
  }

  const newRights = beforeRights.concat([buildNewRight()]);
  if (newRights.length !== beforeCount + 1) {
    return {
      appId: appId,
      appName: appName,
      beforeCount: beforeCount,
      afterCount: newRights.length,
      result: 'エラー',
      detail: 'エントリ数の増分が想定と異なるため送信を中止（元の長さ+1ではない）',
    };
  }

  await kintoneAdmin.apiPut('/k/v1/preview/app/acl.json', {
    app: appId,
    rights: newRights,
    revision: before.revision,
  });

  const after = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
  const afterRights = after.rights;
  const afterGrant = findExistingGrant(afterRights);

  if (afterRights.length < beforeCount) {
    return {
      appId: appId,
      appName: appName,
      beforeCount: beforeCount,
      afterCount: afterRights.length,
      result: 'エラー',
      detail: '送信後にエントリ数が元より減っていることを検知しました。至急確認してください',
    };
  }

  if (!afterGrant || afterGrant.appEditable !== true) {
    return {
      appId: appId,
      appName: appName,
      beforeCount: beforeCount,
      afterCount: afterRights.length,
      result: 'エラー',
      detail: '送信後の再取得でgithub-botのappEditable:trueを確認できませんでした',
    };
  }

  return {
    appId: appId,
    appName: appName,
    beforeCount: beforeCount,
    afterCount: afterRights.length,
    result: '新規追加',
    detail: '',
  };
}

function printReport(results) {
  console.log('');
  console.log('=== ACL一括付与 結果 ===');
  console.log('アプリID\tアプリ名\t処理前\t処理後\t結果\t詳細');
  for (const r of results) {
    console.log(
      r.appId + '\t' + r.appName + '\t' + r.beforeCount + '\t' + r.afterCount + '\t' + r.result + '\t' + r.detail
    );
  }

  const newlyGranted = results.filter((r) => r.result === '新規追加').length;
  const noChange = results.filter((r) => r.result === '変更不要').length;
  const errors = results.filter((r) => r.result === 'エラー').length;

  console.log('');
  console.log('総数：' + results.length + '件（新規追加：' + newlyGranted + '件／変更不要：' + noChange + '件／エラー：' + errors + '件）');
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));
  console.log('ACL一括付与（テスト環境のみ）を開始します');
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
        beforeCount: 0,
        afterCount: 0,
        result: 'エラー',
        detail: error.message,
      });
      console.log(appId + '：エラー：' + error.message);
    }
  }

  printReport(results);
  writeNewlyGrantedOutput(results);

  const hasError = results.some((r) => r.result === 'エラー');
  if (hasError) {
    process.exit(1);
  }
}

function writeNewlyGrantedOutput(results) {
  const newlyGrantedIds = results.filter((r) => r.result === '新規追加').map((r) => r.appId);
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, 'newly_granted_apps=' + newlyGrantedIds.join(',') + '\n', 'utf8');
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
