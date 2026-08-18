/**
 * clasp の初期設定。
 *   npm run gas:setup -- <スクリプトID>
 *
 * スクリプトIDは GASエディタ → プロジェクトの設定 → スクリプト ID で確認できる。
 * WebアプリURLの AKfycb... は「デプロイID」であって「スクリプトID」ではない。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, runClasp, runClaspCapture, fail, ok, info, assertAccount } from './lib.mjs';

// 引数が無ければ .clasp.json に既に入っている値を使う
function existingScriptId() {
  try {
    const config = JSON.parse(readFileSync(path.join(repoRoot, '.clasp.json'), 'utf8'));
    const id = config.scriptId;
    return (id && id !== 'PUT_YOUR_SCRIPT_ID_HERE') ? id : null;
  } catch (error) {
    return null;
  }
}

assertAccount();

const scriptId = process.argv[2] || existingScriptId();

if (!scriptId) {
  fail('スクリプトIDを指定してください。\n' +
       '  例: npm run gas:setup -- 1AbCdEfGhIjKlMn...\n\n' +
       'GASエディタ → プロジェクトの設定 → スクリプト ID からコピーできます。');
}

if (scriptId === 'PUT_YOUR_SCRIPT_ID_HERE' || scriptId.startsWith('AKfycb')) {
  fail('これはスクリプトIDではありません。\n' +
       'AKfycb... で始まるのは「デプロイID」です。\n' +
       'GASエディタ → プロジェクトの設定 → スクリプト ID を使ってください。');
}

// 1) .clasp.json を書き換え
const claspConfig = { scriptId, rootDir: '.' };
writeFileSync(
  path.join(repoRoot, '.clasp.json'),
  JSON.stringify(claspConfig, null, 2) + '\n',
  'utf8'
);
ok(`.clasp.json を更新しました (scriptId: ${scriptId})`);

// 2) appsscript.json（マニフェスト）を GAS から取得する。
//    ローカルで作るとタイムゾーンや Web アプリの公開設定を壊すため必ず本物を取る。
//    修正済みの Code.gs が古い内容で上書きされないよう、一時ディレクトリで受ける。
info('\nGAS からマニフェストを取得しています...');

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'clasp-pull-'));

try {
  writeFileSync(
    path.join(tmpDir, '.clasp.json'),
    JSON.stringify({ scriptId, rootDir: '.' }, null, 2) + '\n',
    'utf8'
  );

  const status = runClasp(['pull'], tmpDir);

  const pulled = path.join(tmpDir, 'appsscript.json');

  if (status !== 0 || !existsSync(pulled)) {
    fail('マニフェストを取得できませんでした。次を確認してください:\n' +
         '  1. https://script.google.com/home/usersettings で\n' +
         '     「Google Apps Script API」がオンになっているか\n' +
         '  2. npm run gas:login を実行済みか\n' +
         '  3. スクリプトIDが正しいか（所有者アカウントでログインしているか）');
  }

  copyFileSync(pulled, path.join(repoRoot, 'appsscript.json'));
  ok('appsscript.json を取得しました');

} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// 3) このプロジェクトが、リポジトリの Web アプリ URL に対応するデプロイを
//    持っているかを確認する。
//    スプレッドシートで「拡張機能 → Apps Script」を押したとき、
//    バインド型スクリプトが存在しないと Google は「無題のプロジェクト」を
//    新規作成する。そのIDを設定してしまうと、本番とは別の空プロジェクトに
//    push することになる。ここで検出する。
const EXPECTED_DEPLOYMENT_ID =
  'AKfycbwQi1nQI1jDspUlagORpKHtpj3NBbQ5RNNkkcXqhsE-WM_j_w10CvO0CAPkVZFT5Vxh';

info('\nデプロイを確認しています...');
const deployments = runClaspCapture(['deployments']);
const output = deployments.stdout + deployments.stderr;

if (output.includes(EXPECTED_DEPLOYMENT_ID)) {
  ok('本番のデプロイを確認しました');
  info('\nセットアップ完了。以降はこれだけで反映できます:');
  info('  npm run gas:release\n');
} else {
  const listed = [...output.matchAll(/AKfycb[A-Za-z0-9_-]+/g)].map(m => m[0]);

  info('');
  info('⚠️ このプロジェクトに、リポジトリが参照している本番デプロイがありません。');
  info('');
  info(`  探したデプロイID: ${EXPECTED_DEPLOYMENT_ID.slice(0, 24)}...`);
  info(`  見つかったデプロイ: ${listed.length ? listed.map(s => s.slice(0, 24) + '...').join(', ') : 'なし'}`);
  info('');
  info('別のプロジェクトを指している可能性があります。よくある原因:');
  info('  スプレッドシートで「拡張機能 → Apps Script」を押したとき、');
  info('  バインド型スクリプトが無いと Google が「無題のプロジェクト」を新規作成する。');
  info('  本番が独立（スタンドアロン）プロジェクトの場合、これに当たる。');
  info('');
  info('正しいプロジェクトを探す:');
  info('  npm run gas:list');
  info('  → 目的のプロジェクトのIDで npm run gas:setup -- <ID> をやり直す');
  info('');
  info('このまま進めると、本番ではないプロジェクトに push されます。');
  process.exit(1);
}
