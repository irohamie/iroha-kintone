'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function verifySize(buffer, expectedSize, label) {
  const actual = buffer.length;
  const expected = Number(expectedSize);

  if (actual !== expected) {
    throw new Error(
      label + '：期待 ' + expected + ' バイトに対し実際 ' + actual + ' バイト。切り詰めの可能性があるため処理を中止します'
    );
  }
}

function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function checkJsSyntax(filePath) {
  try {
    execFileSync('node', ['--check', filePath], { stdio: 'pipe' });
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : error.message;
    throw new Error(filePath + '：構文チェックに失敗しました：' + stderr);
  }
}

function formatTable(headers, rows) {
  const lines = [];
  lines.push(headers.join('\t'));
  for (const row of rows) {
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}

module.exports = {
  verifySize: verifySize,
  md5Hex: md5Hex,
  checkJsSyntax: checkJsSyntax,
  formatTable: formatTable,
};
