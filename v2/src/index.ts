/**
 * テイクアウト予約システム v2
 * Cloudflare Workers + Hono + D1
 */
import { Hono } from 'hono';

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_NAME: string;
  ADMIN_EMAIL: string;
  TIMEZONE: string;
  // 秘密情報（wrangler secret put で登録）
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_PASSWORD_HASH?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

/** 疎通確認とスキーマの導通確認を兼ねる */
app.get('/api/health', async (c) => {
  const stores = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM stores WHERE active = 1')
    .first<{ n: number }>();

  const products = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM products WHERE visible = 1')
    .first<{ n: number }>();

  return c.json({
    ok: true,
    stores: stores?.n ?? 0,
    products: products?.n ?? 0,
    time: new Date().toISOString()
  });
});

/**
 * フォームが必要とするマスタをまとめて返す。
 * 現行は products.json / stores.json を個別に fetch していたが、
 * 1リクエストにまとめる。
 */
app.get('/api/masters', async (c) => {
  const [stores, hours, products] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, group_id, group_name
         FROM stores WHERE active = 1 ORDER BY sort_order`
    ).all(),
    c.env.DB.prepare(
      `SELECT store_id, weekday, open_time, close_time
         FROM store_hours ORDER BY store_id, weekday, open_time`
    ).all(),
    c.env.DB.prepare(
      `SELECT * FROM products WHERE visible = 1 ORDER BY sort_order`
    ).all()
  ]);

  return c.json({
    stores: stores.results,
    storeHours: hours.results,
    products: products.results
  });
});

// 静的ファイルは Workers Static Assets が自動で処理する。
// API に一致しないパスはそちらへ委譲される。

export default app;
