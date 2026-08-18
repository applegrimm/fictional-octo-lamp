/**
 * push 前のアカウント照合。
 * gas:push は clasp を直接呼ぶため、その前段でこのスクリプトを挟む。
 */
import { assertAccount } from './lib.mjs';
assertAccount();
