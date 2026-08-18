/**
 * 既存デプロイを「新バージョン」で更新する。
 *
 * 重要: 新規デプロイを作ると Web アプリ URL が変わり、
 *       index.html / success.html / stripe-config.js(2箇所) /
 *       manage_scripts_phase2.js の差し替えが必要になる。
 *       そのため必ず --deploymentId で既存デプロイを上書きする。
 */
import { spawnSync } from 'node:child_process';
import { runClasp, repoRoot, info, ok, fail } from './lib.mjs';

// デプロイID = Web アプリ URL /macros/s/<ここ>/exec の部分
const DEFAULT_DEPLOYMENT_ID =
  'AKfycbwQi1nQI1jDspUlagORpKHtpj3NBbQ5RNNkkcXqhsE-WM_j_w10CvO0CAPkVZFT5Vxh';

const deploymentId = process.env.GAS_DEPLOYMENT_ID || DEFAULT_DEPLOYMENT_ID;

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
       'npm run gas:status でデプロイ一覧を確認してください。\n' +
       '別のデプロイIDを使う場合: GAS_DEPLOYMENT_ID=AKfycb... npm run gas:deploy');
}

ok('デプロイ更新完了（Web アプリ URL は変わりません）');
info('\n初回のみ、GASエディタで rotateAllStoreSecrets() を1回実行してください。');
info('店舗管理シークレットが登録され、24店舗分の新URLがログに出力されます。');
