/**
 * 現行の products.json / stores.json から D1 用の seed.sql を生成する。
 *
 *   npm run db:seed:build
 *
 * 現行データの実態に合わせた変換を行う:
 *  - stores.hours は曜日 → [開始, 終了] または [[開始,終了],[開始,終了]]。
 *    後者（中休みなど）にも対応して store_hours の複数行に展開する。
 *  - hours が null の曜日は定休日として行を作らない。
 *  - products の salesPeriod / pickupDateRange / deliveryDateRange は
 *    enabled が false なら NULL として展開する。
 *  - storeIds / storeGroups は現行データに1件も設定が無いため、
 *    product_stores は空のまま（＝全店取扱い）とする。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const v2Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(v2Root, '..');

const stores = JSON.parse(readFileSync(path.join(repoRoot, 'stores.json'), 'utf8'));
const products = JSON.parse(readFileSync(path.join(repoRoot, 'products.json'), 'utf8'));

const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** SQL 文字列リテラルに変換（NULL 対応） */
function sql(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 真偽値を 0/1 に */
function bool(value) {
  return value ? 1 : 0;
}

/** enabled が真のときだけ値を返す */
function ranged(range, key) {
  if (!range || !range.enabled) return null;
  return range[key] || null;
}

const lines = [];
lines.push('-- 自動生成: npm run db:seed:build');
lines.push('-- 元データ: ../stores.json / ../products.json');
lines.push('-- 手で編集しないこと');
lines.push('');
lines.push('PRAGMA foreign_keys = ON;');
lines.push('');
lines.push('DELETE FROM product_stores;');
lines.push('DELETE FROM store_hours;');
lines.push('DELETE FROM products;');
lines.push('DELETE FROM stores;');
lines.push('');

// --- 店舗 ---
lines.push('-- 店舗');
stores.forEach((store, index) => {
  lines.push(
    `INSERT INTO stores (id, name, group_id, group_name, active, sort_order) VALUES ` +
    `(${sql(store.id)}, ${sql(store.name)}, ${sql(store.group)}, ${sql(store.groupName)}, 1, ${index});`
  );
});
lines.push('');

// --- 営業時間 ---
lines.push('-- 営業時間');
let hourRows = 0;
for (const store of stores) {
  const hours = store.hours || {};
  for (const [key, value] of Object.entries(hours)) {
    const weekday = WEEKDAY_INDEX[key];
    if (weekday === undefined || !value) continue;  // 定休日は行を作らない

    // [["10:00","14:00"],["17:00","21:00"]] にも ["10:00","21:30"] にも対応
    const spans = Array.isArray(value[0]) ? value : [value];
    for (const span of spans) {
      if (!Array.isArray(span) || span.length < 2) continue;
      lines.push(
        `INSERT INTO store_hours (store_id, weekday, open_time, close_time) VALUES ` +
        `(${sql(store.id)}, ${weekday}, ${sql(span[0])}, ${sql(span[1])});`
      );
      hourRows++;
    }
  }
}
lines.push('');

// --- 商品 ---
lines.push('-- 商品');
products.forEach((product, index) => {
  const minType = product.minType === 'business' ? 'business' : 'calendar';
  lines.push(
    `INSERT INTO products (
  id, name, price, description, image_url, visible, sort_order,
  min_days, min_type, cutoff, pickup_start, pickup_end,
  sales_start, sales_end, sales_start_time, sales_end_time,
  delivery_available, delivery_min_days, delivery_cutoff, delivery_start, delivery_end,
  noshi_available
) VALUES (
  ${sql(product.id)}, ${sql(product.name)}, ${Number(product.price) || 0},
  ${sql(product.description)}, ${sql(product.imageUrl)},
  ${bool(product.visible !== false)}, ${index},
  ${Number(product.minDays) || 0}, ${sql(minType)}, ${sql(product.cutoff)},
  ${sql(ranged(product.pickupDateRange, 'startDate'))}, ${sql(ranged(product.pickupDateRange, 'endDate'))},
  ${sql(ranged(product.salesPeriod, 'startDate'))}, ${sql(ranged(product.salesPeriod, 'endDate'))},
  ${sql(ranged(product.salesPeriod, 'startTime'))}, ${sql(ranged(product.salesPeriod, 'endTime'))},
  ${bool(product.deliveryAvailable)}, ${Number(product.deliveryMinDays) || 7},
  ${sql(product.deliveryCutoff || '12:00')},
  ${sql(ranged(product.deliveryDateRange, 'startDate'))}, ${sql(ranged(product.deliveryDateRange, 'endDate'))},
  ${bool(product.noshiAvailable)}
);`
  );
});
lines.push('');

// --- 商品の取扱店舗 ---
const withStoreLimit = products.filter(
  p => (p.storeIds && p.storeIds.length) || (p.storeGroups && p.storeGroups.length)
);
lines.push('-- 商品の取扱店舗');
if (withStoreLimit.length === 0) {
  lines.push('-- 現行データには storeIds / storeGroups の設定が1件も無いため、');
  lines.push('-- product_stores は空（= 全商品を全店舗で取扱い）とする。');
} else {
  for (const product of withStoreLimit) {
    const ids = new Set(product.storeIds || []);
    for (const group of product.storeGroups || []) {
      stores.filter(s => s.group === group).forEach(s => ids.add(s.id));
    }
    for (const storeId of ids) {
      lines.push(
        `INSERT INTO product_stores (product_id, store_id) VALUES ` +
        `(${sql(product.id)}, ${sql(storeId)});`
      );
    }
  }
}
lines.push('');

writeFileSync(path.join(v2Root, 'db', 'seed.sql'), lines.join('\n') + '\n', 'utf8');

console.log('✅ db/seed.sql を生成しました');
console.log(`   店舗:       ${stores.length} 件`);
console.log(`   営業時間:   ${hourRows} 行`);
console.log(`   商品:       ${products.length} 件（表示: ${products.filter(p => p.visible !== false).length} 件）`);
console.log(`   取扱店舗:   ${withStoreLimit.length === 0 ? '設定なし（全店取扱い）' : withStoreLimit.length + ' 商品に設定'}`);
