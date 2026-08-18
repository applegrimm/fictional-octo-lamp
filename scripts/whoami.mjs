/**
 * clasp が現在どのアカウントで認証しているかを表示する。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { currentAccount, repoRoot, info } from './lib.mjs';

const account = currentAccount();
info(`clasp の認証アカウント: ${account || '（未ログイン、または取得できませんでした）'}`);

try {
  const config = JSON.parse(readFileSync(path.join(repoRoot, 'gas.config.json'), 'utf8'));
  info(`想定アカウント:         ${config.expectedAccount}`);
  if (account && config.expectedAccount &&
      account.toLowerCase() !== config.expectedAccount.toLowerCase()) {
    info('\n⚠️ 一致していません。npm run gas:logout してから gas:login をやり直してください。');
  }
} catch (error) {
  // gas.config.json が無い場合は何もしない
}

try {
  const clasp = JSON.parse(readFileSync(path.join(repoRoot, '.clasp.json'), 'utf8'));
  info(`スクリプトID:           ${clasp.scriptId}`);
} catch (error) {
  info('スクリプトID:           （.clasp.json が読めません）');
}
