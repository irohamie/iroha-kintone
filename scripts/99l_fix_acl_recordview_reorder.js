'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const kintoneAdmin = require('./lib/kintone_admin.js');

const REPO_ROOT = path.join(__dirname, '..');

function getGrantEntityCode() {
  const code = process.env.KINTONE_USERNAME;
  if (!code) {
    throw new Error('環境変数 KINTONE_USERNAME が設定されていません（対象アカウントのログイン名が必要です）');
  }
  return code;
}

const GRANT_ENTITY_CODE = getGrantEntityCode();

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

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function runGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function backupAndPush(appId, aclData) {
  const dirName = '_backup_before/' + todayCompact() + '_App' + appId + '_acl_reorder';
  const dirPath = path.join(REPO_ROOT, dirName);
  const filePath = path.join(dirPath, 'acl_before.json');

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(aclData, null, 2) + '\n', 'utf8');

  const relativePath = path.join(dirName, 'acl_before.json');
  runGit(['add', relativePath]);

  const status = runGit(['status', '--porcelain', '--', relativePath]).trim();
  if (status === '') {
    return;
  }

  runGit(['commit', '-m', 'ACL並び替え前退避：App' + appId + ' ' + new Date().toISOString().slice(0, 10)]);
  runGit(['push']);
}

function findGrantIndex(rights) {
  for (let i = 0; i < rights.length; i++) {
    const right = rights[i];
    if (right.entity && right.entity.type === 'USER' && right.entity.code === GRANT_ENTITY_CODE) {
      return i;
    }
  }
  return -1;
}

function findCreatorIndex(rights) {
  for (let i = 0; i < rights.length; i++) {
    if (rights[i].entity && rights[i].entity.type === 'CREATOR') {
      return i;
    }
  }
  return -1;
}

function buildFixedRight() {
  return {
    entity: { type: 'USER', code: GRANT_ENTITY_CODE },
    includeSubs: false,
    appEditable: true,
    recordViewable: true,
    recordAddable: false,
    recordEditable: false,
    recordDeletable: false,
    recordImportable: false,
    recordExportable: false,
  };
}

async function processApp(appId) {
  const before = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
  const beforeRights = before.rights;
  const beforeCount = beforeRights.length;

  const grantIndex = findGrantIndex(beforeRights);
  if (grantIndex === -1) {
    return { appId: appId, result: 'エラー', detail: '対象アカウントのエントリが見つかりませんでした' };
  }

  try {
    backupAndPush(appId, before);
  } catch (backupError) {
    return { appId: appId, result: 'エラー', detail: '変更前退避のコミット・pushに失敗したため中止：' + backupError.message };
  }

  const withoutGrant = beforeRights.slice(0, grantIndex).concat(beforeRights.slice(grantIndex + 1));
  const creatorIndex = findCreatorIndex(withoutGrant);
  const insertIndex = creatorIndex !== -1 ? creatorIndex + 1 : Math.min(1, withoutGrant.length);
  const newRights = withoutGrant.slice(0, insertIndex).concat([buildFixedRight()]).concat(withoutGrant.slice(insertIndex));

  if (newRights.length !== beforeCount) {
    return {
      appId: appId,
      result: 'エラー',
      detail: 'エントリ数が変化したため送信を中止（前:' + beforeCount + ' 後:' + newRights.length + '）',
    };
  }

  await kintoneAdmin.apiPut('/k/v1/preview/app/acl.json', {
    app: appId,
    rights: newRights,
    revision: before.revision,
  });

  const after = await kintoneAdmin.apiGet('/k/v1/preview/app/acl.json', { app: appId });
  if (after.rights.length < beforeCount) {
    return { appId: appId, result: 'エラー', detail: '送信後にエントリ数が減っていることを検知しました。至急確認してください' };
  }

  const afterGrantIndex = findGrantIndex(after.rights);
  const afterGrant = after.rights[afterGrantIndex];
  if (!afterGrant || afterGrant.appEditable !== true || afterGrant.recordViewable !== true) {
    return { appId: appId, result: 'エラー', detail: '送信後の再取得で期待した権限を確認できませんでした' };
  }

  return {
    appId: appId,
    result: '成功',
    detail: '新しい位置：' + afterGrantIndex + '番目（0始まり、全' + after.rights.length + '件中）、appEditable=true、recordViewable=true',
  };
}

async function main() {
  const { apps } = parseArgs(process.argv.slice(2));

  if (apps.length === 0) {
    console.log('対象アプリが指定されていません（--apps=... が必要です）');
    process.exit(1);
    return;
  }

  console.log('ACL並び替え＋レコード閲覧付与を開始します（テスト環境のみ）');
  console.log('対象アプリ数：' + apps.length + '件');

  const results = [];
  for (const appId of apps) {
    try {
      const result = await processApp(appId);
      results.push(result);
      console.log(appId + '：' + result.result + '：' + result.detail);
    } catch (error) {
      results.push({ appId: appId, result: 'エラー', detail: error.message });
      console.log(appId + '：エラー：' + error.message);
    }
  }

  console.log('');
  console.log('=== 結果 ===');
  for (const r of results) {
    console.log(r.appId + '\t' + r.result + '\t' + r.detail);
  }

  if (results.some((r) => r.result === 'エラー')) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
