'use strict';

const kintone = require('./lib/kintone.js');

const TARGET_APP_ID = '228';

function printHeader(title) {
  console.log('');
  console.log('=== ' + title + ' ===');
}

function isAccessDeniedMessage(message) {
  if (!message) return false;
  return /アクセスが拒否|access.*denied|permission/i.test(message);
}

function reportFailure(error) {
  console.log('失敗');
  console.log(error.message);
  if (isAccessDeniedMessage(error.message) || /HTTP 403/.test(error.message)) {
    console.log('IPアドレス制限またはセキュアアクセスの可能性があります。設計変更が必要です');
  }
}

async function checkAppsList() {
  printHeader('1. GET /k/v1/apps.json?limit=1（アプリ一覧）');
  try {
    const result = await kintone.apiGet('/k/v1/apps.json', { limit: 1, offset: 0 });
    const count = Array.isArray(result.apps) ? result.apps.length : 0;
    console.log('成功');
    console.log('取得件数：' + count + '件（limit=1指定のため参考値。総アプリ数はPhase 1の全件取得で確認します）');
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

async function checkProductionCustomize() {
  printHeader('2. GET /k/v1/app/customize.json?app=' + TARGET_APP_ID + '（運用環境のカスタマイズ設定）');
  try {
    const result = await kintone.apiGet('/k/v1/app/customize.json', { app: TARGET_APP_ID });
    const jsCount = result.desktop && result.desktop.js ? result.desktop.js.length : 0;
    console.log('成功');
    console.log('scope：' + result.scope);
    console.log('desktop.js件数：' + jsCount);
    console.log('revision：' + result.revision);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

async function checkPreviewCustomize() {
  printHeader('3. GET /k/v1/preview/app/customize.json?app=' + TARGET_APP_ID + '（テスト環境のカスタマイズ設定）');
  try {
    const result = await kintone.apiGet('/k/v1/preview/app/customize.json', { app: TARGET_APP_ID });
    const jsCount = result.desktop && result.desktop.js ? result.desktop.js.length : 0;
    console.log('成功');
    console.log('scope：' + result.scope);
    console.log('desktop.js件数：' + jsCount);
    console.log('revision：' + result.revision);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

async function checkPreviewFields() {
  printHeader('4. GET /k/v1/preview/app/form/fields.json?app=' + TARGET_APP_ID + '（テスト環境のフィールド一覧）');
  try {
    const result = await kintone.apiGet('/k/v1/preview/app/form/fields.json', { app: TARGET_APP_ID });
    const fieldCount = result.properties ? Object.keys(result.properties).length : 0;
    console.log('成功');
    console.log('フィールド数：' + fieldCount);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

async function main() {
  console.log('kintone 認証疎通確認（Phase 0）を開始します');
  console.log('対象アプリID：' + TARGET_APP_ID);

  const results = [];
  results.push(await checkAppsList());
  results.push(await checkProductionCustomize());
  results.push(await checkPreviewCustomize());
  results.push(await checkPreviewFields());

  printHeader('結果まとめ');
  const successCount = results.filter(Boolean).length;
  console.log(successCount + ' / ' + results.length + ' 件成功');

  if (results.every(Boolean)) {
    console.log('すべて成功しました');
    process.exit(0);
  } else {
    console.log('1件以上失敗しました');
    process.exit(1);
  }
}

main().catch((error) => {
  console.log('予期しないエラーが発生しました');
  console.log(error.message);
  process.exit(1);
});
