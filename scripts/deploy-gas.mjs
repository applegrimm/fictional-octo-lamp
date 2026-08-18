/**
 * 既存デプロイを「新バージョン」で更新する。
 *
 * 重要: 新規デプロイを作ると Web アプリ URL が変わり、
 *       index.html / success.html / stripe-config.js(2箇所) /
 *       manage_scripts_phase2.js の差し替えが必要になる。
 *       そのため必ず --deploymentId で既存デプロイを上書きする。
 *
 * 更新対象は gas.config.json の deploymentId で管理する
 * （環境変数 GAS_DEPLOYMENT_ID で一時的に上書き可能）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runClasp, repoRoot, info, ok, fail, assertAccount } from './lib.mjs';

assertAccount();

function readConfig() {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, 'gas.config.json'), 'utf8'));
  } catch (error) {
    return {};
  }
}

const config = readConfig();
const deploymentId = process.env.GAS_DEPLOYMENT_ID || config.deploymentId;

if (!deploymentId) {
  fail('デプロイIDが設定されていません。\n' +
       '  gas.config.json の deploymentId を設定するか、\n' +
       '  $env:GAS_DEPLOYMENT_ID="AKfycb..." で指定してください。\n' +
       '  一覧は npm run gas:status で確認できます。');
}

/**
 * ローカルがリモートより古くないか確認する。
 * git pull を忘れたまま古いコードをデプロイする事故を防ぐ。
 */
function warnIfBehindRemote() {
  const opts = { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' };

  const branch = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).stdout || '').trim();
  if (!branch || branch === 'HEAD') return;

  // リモートの最新を取得（ネットワーク不通なら黙って諦める）
  spawnSync('git', ['fetch', '--quiet', 'origin', branch], opts);

  const behind = (spawnSync(
    'git', ['rev-list', '--count', `HEAD..origin/${branch}`], opts
  ).stdout || '').trim();

  if (behind && Number(behind) > 0) {
    fail(`ローカルがリモートより ${behind} コミット古いままです。中止しました。\n\n` +
         '  git pull\n' +
         '  npm run gas:release\n\n' +
         'の順で実行してください。\n' +
         '（意図的に古い状態をデプロイする場合は SKIP_GIT_CHECK=1 を指定）');
  }
}

if (!process.env.SKIP_GIT_CHECK) {
  warnIfBehindRemote();
}

function gitShortSha() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32'
  });
  return (r.stdout || '').trim() || 'local';
}

const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
const description = process.argv[2] || `${gitShortSha()} ${timestamp}`;

info(`デプロイID: ${deploymentId}`);
info(`説明:       ${description}\n`);

const status = runClasp(['deploy', '--deploymentId', deploymentId, '--description', description]);

if (status !== 0) {
  fail('デプロイに失敗しました。\n' +
       '  npm run gas:status でデプロイ一覧を確認し、\n' +
       '  gas.config.json の deploymentId が一覧に含まれているか確かめてください。');
}

ok('デプロイ更新完了（Web アプリ URL は変わりません）');
info('\n初回のみ、GASエディタで rotateAllStoreSecrets() を1回実行してください。');
info('店舗管理シークレットが登録され、店舗ごとの管理画面URLがログに出力されます。');
