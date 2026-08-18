/**
 * コミット前の簡易チェック。
 * Node.js だけで完結させている（Windows に python3 があるとは限らないため）。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

let failed = 0;

function report(name, isOk, detail) {
  if (isOk) {
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// --- JavaScript 構文チェック（Code.gs は拡張子を .js にしてから検査）---
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'syntax-'));
try {
  const jsFiles = ['Code.gs', 'stripe-config.js', 'manage_scripts_phase2.js'];

  for (const file of jsFiles) {
    const target = path.join(tmpDir, path.basename(file).replace(/\.gs$/, '.js'));
    writeFileSync(target, readFileSync(path.join(repoRoot, file)));

    const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    report(file, r.status === 0, (r.stderr || '').split('\n')[0]);
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// --- JSON の妥当性 ---
for (const file of ['products.json', 'stores.json', 'stripe-mode.json', 'package.json', '.clasp.json']) {
  try {
    JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));
    report(file, true);
  } catch (e) {
    report(file, false, e.message);
  }
}

// --- 公開ファイルに認証情報が混入していないか ---
const storesRaw = readFileSync(path.join(repoRoot, 'stores.json'), 'utf8');
report(
  'stores.json に認証情報なし',
  !storesRaw.includes('managementSecret'),
  'managementSecret が含まれています。公開ファイルに認証情報を置かないでください'
);

// --- GAS の Web アプリ URL が全ファイルで一致しているか ---
const urlPattern = /https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/g;
const urlFiles = ['index.html', 'success.html', 'stripe-config.js', 'manage_scripts_phase2.js'];
const foundIds = new Set();

for (const file of urlFiles) {
  const content = readFileSync(path.join(repoRoot, file), 'utf8');
  for (const m of content.matchAll(urlPattern)) foundIds.add(m[1]);
}

report(
  'GAS URL が全ファイルで一致',
  foundIds.size <= 1,
  `${foundIds.size} 種類のデプロイIDが混在しています: ${[...foundIds].map(s => s.slice(0, 12) + '...').join(', ')}`
);

// フロントエンドが参照している URL が、実際に更新しているデプロイと一致するか。
// ここがズレると「デプロイしたのに反映されない」状態になる。
try {
  const gasConfig = JSON.parse(readFileSync(path.join(repoRoot, 'gas.config.json'), 'utf8'));
  const front = [...foundIds][0];
  report(
    'フロントの GAS URL とデプロイ先が一致',
    Boolean(front) && front === gasConfig.deploymentId,
    `フロント=${(front || 'なし').slice(0, 16)}... / デプロイ先=${(gasConfig.deploymentId || 'なし').slice(0, 16)}...`
  );
} catch (e) {
  report('gas.config.json との URL 照合', false, e.message);
}

// --- gas.config.json のデプロイIDが設定されているか ---
try {
  const gasConfig = JSON.parse(readFileSync(path.join(repoRoot, 'gas.config.json'), 'utf8'));
  report('gas.config.json に deploymentId あり', Boolean(gasConfig.deploymentId));
  report('gas.config.json に expectedAccount あり', Boolean(gasConfig.expectedAccount));

  // スクリプト内にデプロイIDがハードコードされていないか
  // （設定と実際に使う値がズレる事故を防ぐ）
  const scriptSources = ['scripts/deploy-gas.mjs', 'scripts/setup-clasp.mjs']
    .map(f => readFileSync(path.join(repoRoot, f), 'utf8'))
    .join('\n');
  const hardcoded = [...scriptSources.matchAll(/'AKfycb[A-Za-z0-9_-]{20,}'/g)];
  report(
    'スクリプトにデプロイIDのハードコードなし',
    hardcoded.length === 0,
    hardcoded.map(m => m[0]).join(', ')
  );
} catch (e) {
  report('gas.config.json', false, e.message);
}

console.log('');
if (failed > 0) {
  console.log(`${failed} 件の問題があります`);
  process.exit(1);
}
console.log('すべて問題ありません');
