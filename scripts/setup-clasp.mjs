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
import { repoRoot, runClasp, fail, ok, info, assertAccount } from './lib.mjs';

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

info('\nセットアップ完了。以降はこれだけで反映できます:');
info('  npm run gas:release\n');
