/**
 * clasp 呼び出しなどの共通処理。
 * Windows / macOS / Linux のいずれでも動くよう Node.js で実装している
 * （シェルスクリプトは Windows の Git が改行を CRLF に変換すると
 *   bash が読めなくなるため使わない）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
