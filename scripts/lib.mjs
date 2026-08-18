/**
 * clasp 呼び出しなどの共通処理。
 * Windows / macOS / Linux のいずれでも動くよう Node.js で実装している
 * （シェルスクリプトは Windows の Git が改行を CRLF に変換すると
 *   bash が読めなくなるため使わない）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isWindows = process.platform === 'win32';

/**
 * ローカルにインストールされた clasp の実行ファイルパスを返す
 */
export function claspBin() {
  const name = isWindows ? 'clasp.cmd' : 'clasp';
  const local = path.join(repoRoot, 'node_modules', '.bin', name);

  if (existsSync(local)) return local;

  // グローバルインストールにフォールバック
  return isWindows ? 'clasp.cmd' : 'clasp';
}

/**
 * clasp をカレントディレクトリ指定で実行する
 * @param {string[]} args - clasp に渡す引数
 * @param {string} cwd - 実行ディレクトリ
 * @returns {number} 終了コード
 */
export function runClasp(args, cwd = repoRoot) {
  const result = spawnSync(claspBin(), args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows
  });

  if (result.error) {
    fail(`clasp を実行できませんでした: ${result.error.message}\n` +
         '先に「npm install」を実行してください。');
  }

  return result.status ?? 1;
}

/**
 * clasp を実行し、標準出力を文字列で受け取る
 */
export function runClaspCapture(args, cwd = repoRoot) {
  const result = spawnSync(claspBin(), args, {
    cwd,
    encoding: 'utf8',
    shell: isWindows
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

export function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

export function info(message) {
  console.log(message);
}

export function ok(message) {
  console.log(`✅ ${message}`);
}

/**
 * clasp が現在認証しているアカウントを取得する
 * @returns {string|null} メールアドレス（取得できなければ null）
 */
export function currentAccount() {
  const r = runClaspCapture(['login', '--status']);
  const text = (r.stdout + r.stderr);
  const match = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : null;
}

/**
 * 想定アカウントで認証されているかを確認する。
 * 違っていれば中止する（個人アカウントで会社のプロジェクトを
 * 操作してしまう事故を防ぐため）。
 */
export function assertAccount() {
  let expected = null;
  try {
    const config = JSON.parse(
      readFileSync(path.join(repoRoot, 'gas.config.json'), 'utf8')
    );
    expected = config.expectedAccount || null;
  } catch (error) {
    return; // 設定が無ければ照合しない
  }

  if (!expected) return;

  const actual = currentAccount();

  if (!actual) {
    fail('clasp がどのアカウントで認証しているか確認できませんでした。\n' +
         '  npm run gas:whoami で状態を確認してください。');
  }

  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fail('認証アカウントが想定と違います。中止しました。\n\n' +
         `  想定: ${expected}\n` +
         `  実際: ${actual}\n\n` +
         '正しいアカウントに切り替える手順:\n' +
         '  1. npm run gas:logout\n' +
         '  2. ブラウザで https://accounts.google.com を開き、\n' +
         `     ${expected} に切り替える（または他をログアウトする）\n` +
         '  3. npm run gas:login\n' +
         '     → アカウント選択画面で必ず ' + expected + ' を選ぶ\n\n' +
         '想定アカウント自体を変えたい場合は gas.config.json を編集してください。');
  }

  ok(`認証アカウント: ${actual}`);
}
